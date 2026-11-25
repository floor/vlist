import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";

beforeAll(() => { registerDOM(); });
afterAll(() => { unregisterDOM(); });

// #514: a table that scrolls natively keeps the browser's own vertical bar and
// scrollbar() draws no custom vertical thumb, whatever the platform's scrollbar
// style (classic or overlay). This is what a native-mode list without
// scrollbar() already shows. A table that scrolls synthetically, and any list
// that is not a table, keep the custom thumb.
describe("scrollbar() on a natively scrolling table", () => {
  const CUSTOM = "vlist-viewport--custom-scrollbar";

  const setGutter = (viewport: HTMLElement, gutter: number): void => {
    Object.defineProperty(viewport, "offsetWidth", { configurable: true, get: () => 400 + gutter });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => 400 });
  };

  const mount = (table: boolean, options?: { gutter?: boolean; synthetic?: boolean; grid?: boolean; gutterPx?: number; scrollbarWidth?: string }) => {
    const plugin = scrollbar<{ id: number }>(options?.gutter ? { gutter: true } : undefined);
    const ctx = createPluginMockContext([{ id: 1 }]);
    const modeHandlers: Array<() => void> = [];
    ctx.ctx.emitter.on = ((_event: string, fn: () => void) => {
      modeHandlers.push(fn);
      return () => {};
    }) as typeof ctx.ctx.emitter.on;
    if (table) ctx.ctx.hooks.method("_getTableLayout", () => null);
    if (options?.grid) ctx.dom.root.setAttribute("role", "grid");
    if (options?.synthetic) {
      (ctx.ctx.config as { scrollMode: string }).scrollMode = "synthetic";
      ctx.dom.viewport.style.overflowY = "hidden";
    }
    if (options?.scrollbarWidth) ctx.dom.viewport.style.scrollbarWidth = options.scrollbarWidth;
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

  const done = (mounted: ReturnType<typeof mount>): void => {
    mounted.plugin.destroy!();
    mounted.ctx.cleanup();
  };

  it("draws no custom vertical thumb and leaves the native bar, with overlay or classic scrollbars", () => {
    for (const gutterPx of [0, 8, 15]) {
      const mounted = mount(true, { gutterPx });
      overflow(mounted);
      expect(mounted.track.style.display, `gutter ${gutterPx}`).toBe("none");
      expect(mounted.hover.style.display, `gutter ${gutterPx}`).toBe("none");
      // Without the class, no stylesheet rule hides or reshapes the native bar.
      expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM), `gutter ${gutterPx}`).toBe(false);
      done(mounted);
    }
  });

  it("stays native while scrolling", () => {
    const mounted = mount(true);
    overflow(mounted);
    mounted.plugin.hooks!.onAfterScroll!(20, 1);
    mounted.plugin.hooks!.onAfterScroll!(40, 1);
    expect(mounted.track.style.display).toBe("none");
    expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM)).toBe(false);
    done(mounted);
  });

  it("does not take the gutter option's padding while the native bar is used", () => {
    const mounted = mount(true, { gutter: true });
    overflow(mounted);
    expect(mounted.ctx.dom.viewport.classList.contains("vlist-viewport--gutter")).toBe(false);
    done(mounted);
  });

  it("keeps the custom thumb on a synthetic table", () => {
    const mounted = mount(true, { synthetic: true, gutterPx: 15 });
    overflow(mounted);
    expect(mounted.track.style.display).not.toBe("none");
    expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM)).toBe(true);
    done(mounted);
  });

  it("shows the custom thumb when an auto table switches to synthetic", () => {
    const mounted = mount(true);
    overflow(mounted);
    expect(mounted.track.style.display).toBe("none");
    mounted.ctx.dom.viewport.style.overflowY = "hidden";
    for (const notify of mounted.modeHandlers) notify();
    expect(mounted.track.style.display).not.toBe("none");
    expect(mounted.hover.style.display).not.toBe("none");
    expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM)).toBe(true);
    done(mounted);
  });

  it("keeps the custom thumb when the author hides the native bar", () => {
    const mounted = mount(true, { scrollbarWidth: "none" });
    overflow(mounted);
    expect(mounted.track.style.display).not.toBe("none");
    expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM)).toBe(true);
    done(mounted);
  });

  it("keeps the custom thumb when an author stylesheet rule hides the native bar", () => {
    const style = document.createElement("style");
    style.textContent = "#author-hidden .vlist-viewport { scrollbar-width: none; }";
    document.head.appendChild(style);
    try {
      const plugin = scrollbar<{ id: number }>();
      const ctx = createPluginMockContext([{ id: 1 }]);
      ctx.ctx.emitter.on = ((_event: string, _fn: () => void) => () => {}) as typeof ctx.ctx.emitter.on;
      ctx.ctx.hooks.method("_getTableLayout", () => null);
      ctx.dom.root.id = "author-hidden";
      ctx.dom.viewport.classList.add("vlist-viewport");
      plugin.setup!(ctx.ctx);
      const track = ctx.dom.root.querySelector(".vlist-scrollbar") as HTMLElement;
      ctx.engineState.totalSize = 4000;
      ctx.engineState.containerSize = 240;
      plugin.hooks!.onResize!(420, 240);
      expect(track.style.display).not.toBe("none");
      expect(ctx.dom.viewport.classList.contains(CUSTOM)).toBe(true);
      plugin.destroy!();
      ctx.cleanup();
    } finally {
      style.remove();
    }
  });

  it("keeps the custom thumb on lists that are not tables", () => {
    for (const grid of [false, true]) {
      const mounted = mount(false, { grid, gutterPx: 15 });
      overflow(mounted);
      expect(mounted.track.style.display, `grid ${grid}`).not.toBe("none");
      expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM), `grid ${grid}`).toBe(true);
      done(mounted);
    }
  });

  it("removes nothing it did not add on destroy", () => {
    const mounted = mount(true);
    overflow(mounted);
    mounted.plugin.destroy!();
    expect(mounted.ctx.dom.viewport.classList.contains(CUSTOM)).toBe(false);
    mounted.ctx.cleanup();
  });
});
