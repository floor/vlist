/**
 * A native thumb drag maps each pointer step through the current content
 * height. autosize() was publishing a new height on every measurement of the
 * top overscan, so the range grew under the pointer and the thumb lagged it.
 */
import { registerDOM, unregisterDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { createVList } from "../../src/core/create";
import type { VListPlugin } from "../../src/core/types";
import { createContainer } from "../helpers/factory";
import type { VListItem } from "../../src/types";
import { autosize } from "../../src/plugins/autosize/plugin";
import { page } from "../../src/plugins/page/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 200, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

interface Row extends VListItem {
  id: number;
  h: number;
}

const template = (item: Row): string => `<div data-h="${item.h}">${item.id}</div>`;

function captureResizeObserver(): {
  measureAll(): void;
  restore(): void;
} {
  const original = globalThis.ResizeObserver;
  const observed = new Set<Element>();
  const callbacks = new Set<ResizeObserverCallback>();

  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) { callbacks.add(cb); }
    observe(el: Element): void { observed.add(el); }
    unobserve(el: Element): void { observed.delete(el); }
    disconnect(): void { observed.clear(); }
  } as unknown as typeof ResizeObserver;

  return {
    measureAll(): void {
      const entries = [...observed]
        .filter((el) => (el as HTMLElement).hasAttribute("data-index"))
        .map((el) => {
          const raw = (el as HTMLElement).querySelector("[data-h]")?.getAttribute("data-h");
          const h = raw ? Number(raw) : 0;
          return {
            target: el,
            contentRect: { width: 300, height: h, top: 0, left: 0, bottom: h, right: 300 } as DOMRectReadOnly,
            borderBoxSize: [{ blockSize: h, inlineSize: 300 }],
          } as unknown as ResizeObserverEntry;
        })
        .filter((entry) => (entry.borderBoxSize[0]!.blockSize as number) > 0);
      if (entries.length > 0) {
        for (const cb of callbacks) cb(entries, {} as ResizeObserver);
      }
    },
    restore(): void { globalThis.ResizeObserver = original; },
  };
}

const translateY = (el: HTMLElement): number => {
  const match = /translateY\(([-\d.]+)px\)/.exec(el.style.transform);
  if (!match?.[1]) throw new Error("missing translateY");
  return Number(match[1]);
};

/** The rendered row at the top of the viewport, and its offset inside it. */
const firstVisible = (content: HTMLElement, scrollTop: number): { index: string; offset: number } => {
  let index = "";
  let start = Infinity;
  for (const el of content.querySelectorAll<HTMLElement>("[data-index]")) {
    const y = translateY(el);
    if (y + 0.5 < scrollTop || y >= start) continue;
    index = el.getAttribute("data-index") ?? "";
    start = y;
  }
  if (!index) throw new Error("no visible row");
  return { index, offset: start - scrollTop };
};

const rowOffset = (content: HTMLElement, viewport: HTMLElement, index: string): number => {
  const el = content.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (!el) throw new Error(`row ${index} left the window`);
  return translateY(el) - viewport.scrollTop;
};

describe("autosize() native scroll", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  // it.serial: replaces the process-global ResizeObserver and the
  // HTMLElement clientHeight/clientWidth getters for the measurement.
  it.serial("a fast downward scroll keeps the content height until idle, and the first visible row stays put", async () => {
    const ro = captureResizeObserver();
    const container = createContainer({ height: 200 });
    const items: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: i, h: 80 }));
    const list = createVList({
      container,
      items,
      item: { estimatedHeight: 40, template },
      scroll: { idleTimeout: 40 },
    }, [autosize()]);
    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    const content = container.querySelector(".vlist-content") as HTMLElement;
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };

    ro.measureAll();
    const steady = content.style.height;
    expect(steady.endsWith("px")).toBe(true);

    // Each jump lands past the rows already measured, so the top overscan is
    // unmeasured and larger than the estimate. That is the correction that
    // was publishing a new height on every step of a downward drag.
    for (let step = 0; step < 4; step++) {
      const rendered = [...content.querySelectorAll<HTMLElement>("[data-index]")];
      const last = rendered[rendered.length - 1];
      if (!last) throw new Error("nothing rendered");
      viewport.scrollTop = translateY(last) + 400;
      viewport.dispatchEvent(new Event("scroll"));
      const visible = firstVisible(content, viewport.scrollTop);
      ro.measureAll();
      expect(content.style.height).toBe(steady);
      expect(rowOffset(content, viewport, visible.index)).toBe(visible.offset);
    }

    await Bun.sleep(80);
    const settled = content.style.height;
    expect(settled).not.toBe(steady);
    await Bun.sleep(80);
    expect(content.style.height).toBe(settled);
  });

  it.serial("a correction past the published height keeps the anchor", () => {
    const ro = captureResizeObserver();
    const container = createContainer({ height: 200 });
    const items: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: i, h: i === 17 ? 4000 : 40 }));
    const list = createVList({
      container,
      items,
      item: { estimatedHeight: 40, template },
      scroll: { idleTimeout: 40 },
    }, [autosize()]);
    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    const content = container.querySelector(".vlist-content") as HTMLElement;
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    let applied = 0;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => applied,
      set: (value: number) => {
        applied = Math.max(0, Math.min(value, parseFloat(content.style.height) - 200));
      },
    });
    ro.measureAll();
    viewport.scrollTop = 800;
    viewport.dispatchEvent(new Event("scroll"));
    const visible = firstVisible(content, viewport.scrollTop);
    ro.measureAll();
    expect(rowOffset(content, viewport, visible.index)).toBe(visible.offset);
    // Room for the shift only. The full measured total is 7960px, and
    // publishing that would grow the native thumb's range mid-drag.
    expect(content.style.height).toBe("4960px");
    expect(viewport.scrollTop).toBe(4760);
  });

  it.serial("a list that has swapped to synthetic does not take a partial pixel height", () => {
    const ro = captureResizeObserver();
    const container = createContainer({ height: 200 });
    let emitMode!: (mode: "native" | "synthetic") => void;
    const probe: VListPlugin<Row> = {
      name: "mode-probe",
      priority: 100,
      setup(ctx) {
        emitMode = (mode) => ctx.emitter.emit("scroll:mode", { mode });
      },
    };
    const items: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: i, h: i === 17 ? 4000 : 40 }));
    const list = createVList({
      container,
      items,
      item: { estimatedHeight: 40, template },
      scroll: { idleTimeout: 40 },
    }, [autosize(), probe]);
    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    const content = container.querySelector(".vlist-content") as HTMLElement;
    cleanup = () => { list.destroy(); container.remove(); ro.restore(); };
    ro.measureAll();
    content.style.height = "100%";
    emitMode("synthetic");
    viewport.scrollTop = 800;
    viewport.dispatchEvent(new Event("scroll"));
    ro.measureAll();
    expect(content.style.height).toBe("100%");
    expect(content.parentElement?.parentElement?.classList.contains("vlist--autosize")).toBe(false);
  });

  it.serial("page scrolling stays native even when the mode option is synthetic", async () => {
    for (const mode of ["native", "synthetic"] as const) {
      const ro = captureResizeObserver();
      const container = createContainer({ height: 200 });
      const keys = ["innerHeight", "scrollY", "scrollTo"] as const;
      const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const);
      let y = 0;
      let content: HTMLElement | undefined;
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 200 });
      Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
      Object.defineProperty(window, "scrollTo", { configurable: true, value: (options: ScrollToOptions): void => {
        y = Math.max(0, Math.min(options.top ?? y, content ? parseFloat(content.style.height) - 200 : 0));
      } });
      const list = createVList({
        container,
        items: Array.from({ length: 100 }, (_, i) => ({ id: i, h: i === 17 ? 4000 : 40 })),
        item: { estimatedHeight: 40, template },
        scroll: { mode, idleTimeout: 40 },
      }, [autosize(), page()]);
      try {
        await Promise.resolve();
        expect(container.querySelector(".vlist")!.classList.contains("vlist--autosize")).toBe(true);
        content = container.querySelector(".vlist-content") as HTMLElement;
        const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
        viewport.getBoundingClientRect = () => new DOMRect(0, -y, 300, 200);
        ro.measureAll();
        y = 800;
        window.dispatchEvent(new Event("scroll"));
        const visible = firstVisible(content, y);
        ro.measureAll();
        const row = content.querySelector<HTMLElement>(`[data-index="${visible.index}"]`)!;
        expect(translateY(row) - y).toBe(visible.offset);
      } finally {
        list.destroy();
        container.remove();
        ro.restore();
        for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(window, key, descriptor);
          else Reflect.deleteProperty(window, key);
        }
      }
    }
  });

  it.serial("a deferred height settles once, follows setItems, and drops on destroy", async () => {
    for (const mode of ["idle", "replace", "destroy"] as const) {
      const ro = captureResizeObserver();
      const container = createContainer({ height: 200 });
      let calls = 0;
      const counter: VListPlugin<Row> = {
        name: "height-counter",
        priority: 100,
        setup(ctx) {
          const original = ctx.render.contentSize;
          ctx.render.contentSize = (size: number): void => {
            calls += 1;
            original(size);
          };
        },
      };
      const list = createVList({
        container,
        items: Array.from({ length: 100 }, (_, i) => ({ id: i, h: 80 })),
        item: { estimatedHeight: 40, template },
        scroll: { idleTimeout: 40 },
      }, [autosize(), counter]);
      try {
        const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
        const content = container.querySelector(".vlist-content") as HTMLElement;
        ro.measureAll();
        const before = content.style.height;
        calls = 0;
        viewport.scrollTop = 1600;
        viewport.dispatchEvent(new Event("scroll"));
        ro.measureAll();
        expect(content.style.height).toBe(before);
        expect(calls).toBe(0);
        if (mode === "replace") {
          list.setItems(Array.from({ length: 100 }, (_, i) => ({ id: i + 1000, h: 40 })));
          expect(content.style.height).toBe("4000px");
        } else if (mode === "destroy") {
          list.destroy();
        }
        await Bun.sleep(80);
        if (mode === "idle") {
          expect(calls).toBe(1);
          expect(content.style.height).not.toBe(before);
          await Bun.sleep(80);
          expect(calls).toBe(1);
        } else if (mode === "replace") {
          expect(content.style.height).toBe("4000px");
        } else {
          expect(calls).toBe(0);
          expect(container.childElementCount).toBe(0);
        }
      } finally {
        list.destroy();
        container.remove();
        ro.restore();
      }
    }
  });

  it.serial("fixed heights keep the same content size across the same scroll", async () => {
    const container = createContainer({ height: 200 });
    const items: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: i, h: 40 }));
    const list = createVList({
      container,
      items,
      item: { height: 40, template },
      scroll: { idleTimeout: 40 },
    });
    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    const content = container.querySelector(".vlist-content") as HTMLElement;
    cleanup = () => { list.destroy(); container.remove(); };

    const steady = content.style.height;
    for (const pos of [800, 1600, 2400, 3200]) {
      viewport.scrollTop = pos;
      viewport.dispatchEvent(new Event("scroll"));
      expect(content.style.height).toBe(steady);
    }
    await Bun.sleep(80);
    expect(content.style.height).toBe(steady);
  });

  it("paint containment is marked on autosize lists only", () => {
    const container = createContainer({ height: 200 });
    const plain = createVList({
      container,
      items: [{ id: 0, h: 40 }],
      item: { height: 40, template },
    });
    const plainRoot = container.querySelector(".vlist") as HTMLElement;
    expect(plainRoot.classList.contains("vlist--autosize")).toBe(false);
    plain.destroy();
    const list = createVList({
      container,
      items: [{ id: 0, h: 40 }],
      item: { estimatedHeight: 40, template },
    }, [autosize()]);
    const root = container.querySelector(".vlist") as HTMLElement;
    expect(root.classList.contains("vlist--autosize")).toBe(true);
    list.destroy();
    expect(root.classList.contains("vlist--autosize")).toBe(false);
    container.remove();
  });
});
