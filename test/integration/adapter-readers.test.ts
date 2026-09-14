import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPluginMockContext } from "../helpers/plugin-context";
import { a11y } from "../../src/plugins/a11y/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { createVList } from "../../src/core/create";
import type { PluginContext, VListPlugin } from "../../src/core/types";
import { createContainer } from "../helpers/factory";
import { snapshots } from "../../src/plugins/snapshots/plugin";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
const setup = () => createPluginMockContext(Array.from({ length: 100 }, (_, id) => ({ id })), { itemSize: 40, containerHeight: 400 });

it("a11y routes focus navigation through the adapter without pre-committing state", () => {
  const t = setup();
  const set = mock((_position: number) => {});
  t.ctx.scroll.getPixelEquivalent = () => 800;
  t.ctx.scroll.setPixelEquivalent = set;
  Object.defineProperty(t.engineState, "scrollPosition", { configurable: true,
    get: () => 400, set: () => { throw new Error("a11y wrote source-owned position"); },
  });
  try {
    a11y().setup!(t.ctx);
    for (const handler of t.keydownHandlers) handler(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
    expect(set).toHaveBeenCalledWith(0);
  } finally { for (const destroy of t.destroyHandlers) destroy(); t.cleanup(); }
});

it("selection compares the focused item with the adapter position", () => {
  const t = setup();
  t.ctx.scroll.getPixelEquivalent = () => 400;
  t.engineState.scrollPosition = 0;
  try {
    selection({ mode: "single" }).setup!(t.ctx);
    for (const handler of t.keydownHandlers) handler(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
    expect(t.scrollCalls).toEqual([0]);
  } finally { for (const destroy of t.destroyHandlers) destroy(); t.cleanup(); }
});

it("snapshots derives the anchor index and offset from adapter pixels", () => {
  const t = setup();
  t.ctx.scroll.getPixelEquivalent = () => 125;
  t.engineState.scrollPosition = 0;
  try {
    snapshots().setup!(t.ctx);
    expect(t.methods.get("getScrollSnapshot")!()).toMatchObject({ index: 3, offsetInItem: 5 });
  } finally { for (const destroy of t.destroyHandlers) destroy(); t.cleanup(); }
});

it("autosize corrects measurements above the adapter's first visible item", () => {
  const t = setup();
  const original = globalThis.ResizeObserver;
  let callback!: ResizeObserverCallback;
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe() {} unobserve() {} disconnect() {}
  };
  const shifts: number[] = [];
  t.ctx.shiftScroll = delta => { shifts.push(delta); };
  t.ctx.scroll.getPixelEquivalent = () => 200;
  t.engineState.scrollPosition = 0;
  const plugin = autosize();
  try {
    plugin.setup!(t.ctx);
    const row = document.createElement("div"); row.dataset.index = "0";
    t.dom.content.appendChild(row);
    t.ctx.getRenderedElement = index => index === 0 ? row : null;
    t.engineState.visibleCount = 1; t.engineState.visibleIndices[0] = 0;
    plugin.hooks!.onCommit!(t.engineState);
    callback([{ target: row, borderBoxSize: [{ blockSize: 60, inlineSize: 400 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    expect(shifts).toEqual([20]);
  } finally { plugin.destroy?.(); t.cleanup(); globalThis.ResizeObserver = original; }
});


it("a11y last-item focus reaches the padded end", () => {
  const host = createContainer();
  let ctx!: PluginContext<{ id: number }>;
  const inspect: VListPlugin<{ id: number }> = { name: "inspect", priority: 100, setup(c) { ctx = c; } };
  const list = createVList({ container: host, padding: [16, 0, 24, 0],
    items: Array.from({ length: 100 }, (_, id) => ({ id })),
    item: { height: 40, template: item => String(item.id) },
  }, [a11y(), inspect]);
  ctx.getState().containerSize = 400;
  try {
    ctx.dom.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(list.getScrollPosition()).toBe(3640);
    expect(ctx.dom.viewport.scrollTop).toBe(3640);
  } finally { list.destroy(); host.remove(); }
});
