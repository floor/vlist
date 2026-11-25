import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";
import { scrollbarGutter } from "../../../src/plugins/scrollbar/scrollbar";

beforeAll(() => { registerDOM(); });
afterAll(() => { unregisterDOM(); });

describe("scrollbarGutter", () => {
  it("is classic when the bar takes width and overlay when it does not", () => {
    const el = document.createElement("div");
    const set = (offset: number, client: number): void => {
      Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => offset });
      Object.defineProperty(el, "clientWidth", { configurable: true, get: () => client });
    };
    set(100, 85);
    expect(scrollbarGutter(el)).toBe(true);
    set(100, 100);
    expect(scrollbarGutter(el)).toBe(false);
    set(0, 0);
    expect(scrollbarGutter(el)).toBe(false);
  });
});

describe("classic table scrollbar", () => {
  const setGutter = (viewport: HTMLElement, gutter: number): void => {
    Object.defineProperty(viewport, "offsetWidth", { configurable: true, get: () => 400 + gutter });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => 400 });
  };

  const mount = (table: boolean, options?: { gutter?: boolean; synthetic?: boolean; grid?: boolean; gutterPx?: number; borderPx?: number; borderEach?: number; scrollbarWidth?: string }) => {
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
    if (options?.borderPx !== undefined) {
      ctx.dom.viewport.style.borderInline = `${options.borderPx}px solid`;
      ctx.dom.viewport.dataset.borderEach = String(options.borderEach ?? options.borderPx);
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

  it("keeps the custom thumb at DPR 1, 1.25 and 1.5, and still counts an 8px or 15px bar", () => {
    const real = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((elt: Element, pseudo?: string | null) => {
      const css = real(elt, pseudo);
      const each = elt instanceof HTMLElement ? elt.dataset.borderEach : undefined;
      if (each === undefined) return css;
      return new Proxy(css, {
        get(target, prop, receiver) {
          if (prop === "borderLeftWidth" || prop === "borderRightWidth") return `${each}px`;
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as typeof window.getComputedStyle;

    const roundHalfToEven = (value: number): number => {
      const floor = Math.floor(value);
      const frac = value - floor;
      if (Math.abs(frac - 0.5) > 1e-9) return Math.round(value);
      return floor % 2 === 0 ? floor : floor + 1;
    };

    try {
      for (const dpr of [1, 1.25, 1.5]) {
        for (const borderPx of [1, 2, 3]) {
          const computedEach = roundHalfToEven(borderPx * dpr) / dpr;
          for (const scrollbarWidth of ["auto", "none"]) {
            const mounted = mount(true, { gutterPx: borderPx * 2, borderPx, borderEach: computedEach, scrollbarWidth });
            overflow(mounted);
            expect(mounted.track.style.display, `dpr ${dpr} border ${borderPx} ${scrollbarWidth}`).not.toBe("none");
            mounted.plugin.destroy!();
            mounted.ctx.cleanup();
          }
        }
      }
      for (const bar of [8, 15]) {
        const plain = mount(true, { gutterPx: bar });
        overflow(plain);
        expect(plain.track.style.display, `${bar}px bar`).toBe("none");
        plain.plugin.destroy!();
        plain.ctx.cleanup();

        const bordered = mount(true, { gutterPx: 4 + bar, borderPx: 2, borderEach: 1.6, scrollbarWidth: "auto" });
        overflow(bordered);
        expect(bordered.track.style.display, `${bar}px bar beside 2px borders at dpr 1.25`).toBe("none");
        bordered.plugin.destroy!();
        bordered.ctx.cleanup();
      }
    } finally {
      window.getComputedStyle = real as typeof window.getComputedStyle;
    }
  });

  it("keeps the custom thumb when 2px inline borders are the whole width difference", () => {
    const bordered = (scrollbarWidth: string, gutterPx: number) => {
      const mounted = mount(true, { gutterPx });
      const vp = mounted.ctx.dom.viewport;
      vp.style.borderInline = "2px solid";
      vp.style.borderLeft = "2px solid";
      vp.style.borderRight = "2px solid";
      vp.style.scrollbarWidth = scrollbarWidth;
      overflow(mounted);
      return mounted;
    };

    const overlay = bordered("auto", 4);
    expect(overlay.track.style.display).not.toBe("none");
    overlay.plugin.destroy!();
    overlay.ctx.cleanup();

    const hiddenBar = bordered("none", 4);
    expect(hiddenBar.track.style.display).not.toBe("none");
    hiddenBar.plugin.destroy!();
    hiddenBar.ctx.cleanup();

    const classic = bordered("auto", 19);
    expect(classic.track.style.display).toBe("none");
    classic.plugin.destroy!();
    classic.ctx.cleanup();
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
