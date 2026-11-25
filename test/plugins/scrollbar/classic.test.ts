import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";
import { scrollbarGutter } from "../../../src/plugins/scrollbar/scrollbar";

beforeAll(() => { registerDOM(); });
afterAll(() => { unregisterDOM(); });

describe("scrollbarGutter", () => {
  it("is classic when the bar takes width and overlay when it does not", () => {
    expect(scrollbarGutter({ offsetWidth: 100, clientWidth: 85 })).toBe(true);
    expect(scrollbarGutter({ offsetWidth: 100, clientWidth: 100 })).toBe(false);
    expect(scrollbarGutter({ offsetWidth: 0, clientWidth: 0 })).toBe(false);
  });
});

describe("classic table scrollbar", () => {
  const setGutter = (viewport: HTMLElement, gutter: number): void => {
    Object.defineProperty(viewport, "offsetWidth", { configurable: true, get: () => 400 + gutter });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => 400 });
  };

  const mount = (table: boolean, options?: { gutter?: boolean; synthetic?: boolean; grid?: boolean; gutterPx?: number }) => {
    const plugin = scrollbar<{ id: number }>(options?.gutter ? { gutter: true } : undefined);
    const ctx = createPluginMockContext([{ id: 1 }]);
    const modeHandlers: Array<() => void> = [];
    ctx.ctx.emitter.on = (( _event: string, fn: () => void) => {
      modeHandlers.push(fn);
      return () => {};
    }) as typeof ctx.ctx.emitter.on;
    if (table) ctx.ctx.hooks.method("_getTableLayout", () => null);
    if (options?.grid) ctx.dom.root.setAttribute("role", "grid");
    if (options?.synthetic) (ctx.ctx.config as { scrollMode: string }).scrollMode = "synthetic";
    setGutter(ctx.dom.viewport, options?.gutterPx ?? 0);
    plugin.setup!(ctx.ctx);
    const track = ctx.dom.root.querySelector(".vlist-scrollbar") as HTMLElement;
    const hover = ctx.dom.root.querySelector(".vlist-scrollbar__hover") as HTMLElement;
    return { plugin, ctx, track, hover, modeHandlers };
  };

  const overflow = (mounted: ReturnType<typeof mount>): void => {
    mounted.ctx.engineState.totalSize = 4000;
    mounted.ctx.engineState.containerSize = 240;
    mounted.plugin.hooks!.onResize!(420, 240);
  };

  it("hides the custom vertical track when this table's viewport has a real gutter", () => {
    const classic = mount(true, { gutterPx: 15 });
    overflow(classic);
    expect(classic.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
    expect(classic.track.style.display).toBe("none");
    classic.plugin.destroy!();
    classic.ctx.cleanup();

    const overlay = mount(true, { gutterPx: 0 });
    overflow(overlay);
    expect(overlay.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
    expect(overlay.track.style.display).not.toBe("none");
    overlay.plugin.destroy!();
    overlay.ctx.cleanup();
  });

  it("keeps the custom thumb on a synthetic table and on a grid that is not a table", () => {
    const synthetic = mount(true, { synthetic: true, gutterPx: 15 });
    synthetic.ctx.dom.viewport.style.overflowY = "hidden";
    overflow(synthetic);
    expect(synthetic.track.style.display).not.toBe("none");
    synthetic.plugin.destroy!();
    synthetic.ctx.cleanup();

    const grid = mount(false, { grid: true, gutterPx: 15 });
    overflow(grid);
    expect(grid.track.style.display).not.toBe("none");
    grid.plugin.destroy!();
    grid.ctx.cleanup();
  });

  it("keeps the custom track on a classic list that is not a table", () => {
    const plain = mount(false, { gutterPx: 15 });
    overflow(plain);
    expect(plain.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
    expect(plain.track.style.display).not.toBe("none");
    plain.plugin.destroy!();
    plain.ctx.cleanup();
  });

  it("restores the track, hover zone, and gutter when the platform bar changes", () => {
    const swapped = mount(true, { gutter: true, gutterPx: 15 });
    overflow(swapped);
    expect(swapped.track.style.display).toBe("none");
    expect(swapped.hover.style.display).toBe("none");
    expect(swapped.ctx.dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);

    setGutter(swapped.ctx.dom.viewport, 0);
    swapped.plugin.hooks!.onResize!(420, 240);
    expect(swapped.track.style.display).not.toBe("none");
    expect(swapped.hover.style.display).not.toBe("none");
    expect(swapped.ctx.dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(true);

    setGutter(swapped.ctx.dom.viewport, 15);
    swapped.plugin.hooks!.onResize!(420, 240);
    expect(swapped.track.style.display).toBe("none");
    expect(swapped.hover.style.display).toBe("none");
    expect(swapped.ctx.dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);
    swapped.plugin.destroy!();
    swapped.ctx.cleanup();
  });

  it("shows the thumb again when the table switches to synthetic, and does not while scrolling", () => {
    const live = mount(true, { gutterPx: 15 });
    overflow(live);
    expect(live.track.style.display).toBe("none");
    live.plugin.hooks!.onAfterScroll!(20, 1);
    live.plugin.hooks!.onAfterScroll!(40, 1);
    expect(live.track.style.display).toBe("none");
    live.ctx.dom.viewport.style.overflowY = "hidden";
    for (const notify of live.modeHandlers) notify();
    expect(live.track.style.display).not.toBe("none");
    live.plugin.destroy!();
    live.ctx.cleanup();
  });
});
