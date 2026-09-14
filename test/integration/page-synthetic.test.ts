import { afterAll, beforeAll, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList as createCore } from "../../src/core/create";
import { createSyntheticScrollHandler } from "../../src/synthetic/handler";
import { createVList } from "../../src/synthetic";
import { table } from "../../src/plugins/table/plugin";
import { page } from "../../src/plugins/page/plugin";
import type { PluginContext } from "../../src/core/types";
import { createContainer } from "../helpers/factory";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

for (const mode of ["bounded", "synthetic"] as const) {
  it(`page uses the document source and origin zero under ${mode}`, () => {
    const host = createContainer();
    let ctx!: PluginContext<{ id: number }>;
    const list = createVList({ container: host,
      items: Array.from({ length: 1000 }, (_, id) => ({ id })),
      item: { height: 40, template: item => String(item.id) },
      padding: [10, 0, 20, 0], scroll: { mode },
    }, [page(), { name: "inspect", setup(c) { ctx = c; } }]);
    try {
      ctx.dom.viewport.getBoundingClientRect = () => ({ top: -400 } as DOMRect);
      window.dispatchEvent(new Event("scroll"));
      expect(list.getScrollPosition()).toBe(400);
      expect(ctx.scroll.getRenderOrigin()).toBe(0);
      expect(ctx.dom.content.style.height).toBe("40030px");
      const item = ctx.dom.content.querySelector<HTMLElement>('[data-index="10"]')!;
      expect(item.style.transform).toBe("translateY(410px)");
      ctx.dom.viewport.scrollTop = 150;
      ctx.dom.viewport.dispatchEvent(new Event("scroll"));
      expect(list.getScrollPosition()).toBe(400);
      ctx.commitScroll(500);
      expect(list.getScrollPosition()).toBe(500);
      expect(ctx.getState().prevScrollPosition).toBe(400);
      expect(ctx.getState().scrollDirection).toBe(1);
    } finally { list.destroy(); host.remove(); }
  });
}

it("page rejects an initial document size over the limit, including padding and deferred rendering", () => {
  for (const defer of [false, true]) {
    const host = createContainer();
    try {
      expect(() => createVList({ container: host, defer,
        items: [{ id: 1 }], item: { height: 16_777_216, template: () => "row" },
        padding: [1, 0], scroll: { mode: "synthetic" },
      }, [page()])).toThrow(/16777218px.*16777216px.*viewport-scrolled default.*https:\/\/vlist.io\/docs\/rfcs\/RFC-014-Scroll-Input-Model/);
      expect(host.children.length).toBe(0);
    } finally { host.remove(); }
  }
});

it("page warns once on later growth past the document limit", async () => {
  const host = createContainer();
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = message => warnings.push(String(message));
  const list = createVList({ container: host, items: [{ id: 1 }],
    item: { height: 10_000_000, template: () => "row" }, scroll: { mode: "synthetic" },
  }, [page()]);
  try {
    await Promise.resolve();
    expect(() => list.appendItems([{ id: 2 }])).not.toThrow();
    list.appendItems([{ id: 3 }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/20000000px.*16777216px.*https:\/\/vlist.io\/docs\/rfcs\/RFC-014-Scroll-Input-Model/);
  } finally { list.destroy(); host.remove(); console.warn = original; }
});

it("external sizing reports initial and custom-layout sizes through the same hook", () => {
  const host = createContainer();
  let ctx!: PluginContext<{ id: number }>;
  const sizes: number[] = [];
  const list = createVList({ container: host, items: [{ id: 1 }],
    item: { height: 40, template: () => "row" }, padding: [10, 0], scroll: { mode: "synthetic" },
  }, [{ name: "external", setup(c) {
    ctx = c;
    c.setScrollSource({ write: px => c.commitScroll(px), onContentSize: px => sizes.push(px) });
  } }]);
  try {
    expect(sizes).toEqual([60]);
    ctx.updateContentSize(80);
    expect(sizes).toEqual([60, 100]);
    expect(ctx.dom.content.style.height).toBe("100px");
    ctx.setScrollFns(() => 0, px => ctx.commitScroll(px));
    list.appendItems([{ id: 2 }]);
    expect(sizes).toEqual([60, 100]);
    ctx.scrollTo(20);
    expect(list.getScrollPosition()).toBe(20);
  } finally { list.destroy(); host.remove(); }
});

for (const defer of [false, true]) it(`custom layout initial sizing guards before ${defer ? "deferred" : "immediate"} rendering`, () => {
  const host = createContainer();
  try {
    expect(() => createVList({ container: host, defer, items: [{ id: 1 }],
      item: { height: 40, template: () => "row" }, scroll: { mode: "synthetic" },
    }, [page(), { name: "layout", priority: 10, setup(ctx) {
      ctx.setRenderFn(() => {}, () => {});
      ctx.updateContentSize(20_000_000);
    } }])).toThrow(/20000000px.*16777216px/);
    expect(host.children.length).toBe(0);
  } finally { host.remove(); }
});

it("deferred table warns on its first size commit when creation did not know its size", () => {
  const host = createContainer();
  const originalWarn = console.warn;
  const originalRaf = globalThis.requestAnimationFrame;
  const warnings: string[] = [];
  let frame!: FrameRequestCallback;
  console.warn = message => warnings.push(String(message));
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  try {
    const list = createVList({ container: host, defer: true, items: [{ id: 1 }, { id: 2 }],
      item: { height: 40, template: () => "row" }, scroll: { mode: "synthetic" },
    }, [page(), table({ rowHeight: 10_000_000, columns: [{ key: "id", label: "ID", width: 100 }] })]);
    try {
      expect(warnings).toHaveLength(0);
      expect(() => frame(performance.now())).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/20000000px.*16777216px.*https:\/\/vlist.io\/docs\/rfcs\/RFC-014-Scroll-Input-Model/);
    } finally { list.destroy(); }
  } finally {
    host.remove(); console.warn = originalWarn; globalThis.requestAnimationFrame = originalRaf;
  }
});

it("plain synthetic lists do not run the document provider's warning", () => {
  const host = createContainer();
  const original = console.warn;
  const warnings: unknown[] = [];
  console.warn = value => warnings.push(value);
  try {
    const list = createVList({ container: host, items: [{ id: 1 }, { id: 2 }],
      item: { height: 10_000_000, template: () => "row" }, scroll: { mode: "synthetic" },
    });
    try {
      list.appendItems([{ id: 3 }]);
      expect(warnings).toHaveLength(0);
    } finally { list.destroy(); }
  } finally { host.remove(); console.warn = original; }
});

it("a synthetic custom renderer refreshes its handler only once when items change", () => {
  const host = createContainer();
  let refreshes = 0;
  const list = createCore({ container: host, items: [{ id: 1 }],
    item: { height: 40, template: () => "row" },
  }, [{ name: "custom", setup(ctx) {
    ctx.setRenderFn(() => {}, () => ctx.updateContentSize(ctx.sizeCache.getTotalSize()));
  } }], config => {
    const handler = createSyntheticScrollHandler(config);
    return { ...handler, refresh(size) { refreshes++; handler.refresh(size); } };
  });
  try {
    refreshes = 0;
    list.setItems([{ id: 1 }, { id: 2 }]);
    expect(refreshes).toBe(1);
  } finally { list.destroy(); host.remove(); }
});
