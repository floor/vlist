/**
 * vlist/vue — real render tests (#328).
 *
 * Mounts components that call `useVList` into the process-wide happy-dom via
 * createApp, lets onMounted create a real vlist, and asserts it virtualizes,
 * updates, tears down, and runs the features it is given — and only those.
 * Ported from vlist-vue, with features passed explicitly instead of as config
 * fields.
 */
import { describe, it as baseIt, expect, beforeAll, afterAll } from "bun:test";

// Serial under `bun test --concurrent`: every test here mounts into the one
// document, swaps the same globals (geometry, ResizeObserver, rAF) and, for
// React, drives one act() queue that does not allow overlapping calls.
const it = baseIt.serial;
import { createApp, h, nextTick, ref, type ShallowRef } from "vue";
import { useVList, useVListEvent, type UseVListConfig } from "../../src/vue";
import {
  autosize,
  createVList,
  grid,
  selection,
  type VListItem,
  type VListPlugin,
} from "../../src/index";
import { capturePrototypeGeometry } from "../helpers/geometry";

interface Row extends VListItem {
  id: string;
}

const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));
const template = (r: Row): string => `<div class="row" data-id="${r.id}">${r.id}</div>`;

const VIEWPORT_H = 500;
const VIEWPORT_W = 300;

// File-wide globals, set before and restored after every test here: the
// prototype geometry, ResizeObserver and requestAnimationFrame. happy-dom does
// not lay out, so vlist would measure a 0px viewport.
let geometry: ReturnType<typeof capturePrototypeGeometry>;
let realRO: typeof ResizeObserver;
let realRAF: typeof requestAnimationFrame;

beforeAll(() => {
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => VIEWPORT_H });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => VIEWPORT_W });
  realRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element): void {
      this.cb([{
        target,
        contentRect: { width: VIEWPORT_W, height: VIEWPORT_H } as DOMRectReadOnly,
        // autosize() measures the border box; a real entry carries both.
        borderBoxSize: [{ inlineSize: VIEWPORT_W, blockSize: VIEWPORT_H }] as unknown as readonly ResizeObserverSize[],
      } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  realRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
});

afterAll(() => {
  geometry.restore();
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRAF;
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/**
 * Mount a component whose setup calls `setup` (which calls useVList and returns
 * its containerRef), flushing onMounted and the rAF-scheduled first render.
 */
async function mount(setup: () => { containerRef: unknown }): Promise<{ host: HTMLElement; unmount: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup() {
      const { containerRef } = setup();
      return () => h("div", { ref: containerRef as never, style: { height: `${VIEWPORT_H}px` } });
    },
  });
  app.mount(host);
  await nextTick();
  await flush();
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe("vlist/vue useVList", () => {
  it("mounts and virtualizes a large list", async () => {
    let instance: ShallowRef<unknown> | null = null;
    const m = await mount(() => {
      const r = useVList<Row>({ item: { height: 40, template }, items: rows(1000) });
      instance = r.instance;
      return r;
    });
    try {
      expect(instance!.value).not.toBeNull();
      const rendered = m.host.querySelectorAll(".row");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(100);
    } finally { m.unmount(); }
  });

  it("updates the list when a Ref config's items change", async () => {
    const config = ref<UseVListConfig<Row>>({ item: { height: 40, template }, items: rows(3) });
    const m = await mount(() => useVList<Row>(config));
    try {
      expect(m.host.querySelectorAll(".row").length).toBe(3);
      config.value = { ...config.value, items: rows(5) };
      await nextTick();
      await flush();
      expect(m.host.querySelectorAll(".row").length).toBe(5);
    } finally { m.unmount(); }
  });

  it("destroys the instance on unmount", async () => {
    let instance: ShallowRef<{ destroy(): void } | null> | null = null;
    const m = await mount(() => {
      const r = useVList<Row>({ item: { height: 40, template }, items: rows(100) });
      instance = r.instance;
      return r;
    });
    const list = instance!.value!;
    let destroyed = 0;
    const destroy = list.destroy.bind(list);
    list.destroy = () => { destroyed++; destroy(); };
    m.unmount();
    expect(destroyed).toBe(1);
    expect(instance!.value).toBeNull();
  });

  it("#119: runs the plugins it is given, autosize included", async () => {
    let instance: ShallowRef<unknown> | null = null;
    const m = await mount(() => {
      const r = useVList<Row>(
        { item: { estimatedHeight: 200, template }, items: rows(200) },
        [autosize(), selection({ mode: "single" })],
      );
      instance = r.instance;
      return r;
    });
    try {
      expect(instance!.value).not.toBeNull();
      expect(m.host.querySelectorAll(".row").length).toBeGreaterThan(0);
    } finally { m.unmount(); }
  });

  it("a feature passed explicitly works: grid lays out columns, selection selects", async () => {
    let select: ((...ids: Array<string | number>) => void) | undefined;
    let selected: (() => Array<string | number>) | undefined;
    const m = await mount(() => {
      const r = useVList(
        { item: { height: 40, template }, items: rows(40) },
        [grid<Row>({ columns: 4 }), selection<Row>({ mode: "multiple" })],
      );
      // Typed from the plugins passed: no cast for select().
      select = (...ids) => r.instance.value?.select(...ids);
      selected = () => r.instance.value?.getSelected() ?? [];
      return r;
    });
    try {
      const items = [...m.host.querySelectorAll<HTMLElement>(".vlist-grid-item")];
      expect(items.length).toBeGreaterThan(4);
      // Four columns: the first four items share a row (same translateY), the fifth starts the next.
      const ys = items.slice(0, 5).map((el) => el.style.transform.match(/,\s*([-\d.]+)px/)?.[1] ?? el.style.transform);
      expect(new Set(ys.slice(0, 4)).size).toBe(1);
      expect(ys[4]).not.toBe(ys[0]);
      select!("row-2");
      expect(selected!()).toEqual(["row-2"]);
    } finally { m.unmount(); }
  });

  it("the instance carries only the methods of the plugins passed (types)", () => {
    const typed = () => {
      const withSelection = useVList({ item: { height: 40, template }, items: rows(1) }, [selection<Row>()]);
      withSelection.instance.value?.select("a");
      const plain = useVList({ item: { height: 40, template }, items: rows(1) }, []);
      // @ts-expect-error select() comes from selection(), which was not passed
      plain.instance.value?.select("a");
    };
    expect(typeof typed).toBe("function");
  });

  it("uses the advanced `create` argument with the config and plugins", async () => {
    const calls: Array<{ plugins: string[]; hasContainer: boolean }> = [];
    const create = ((config: Parameters<typeof createVList>[0], plugins?: VListPlugin[]) => {
      calls.push({ plugins: (plugins ?? []).map((p) => p.name), hasContainer: !!config.container });
      return createVList(config, plugins);
    }) as typeof createVList;
    const m = await mount(() => useVList<Row>({ item: { height: 40, template }, items: rows(10) }, [selection<Row>()], create));
    try {
      expect(calls).toEqual([{ plugins: ["selection"], hasContainer: true }]);
      expect(m.host.querySelectorAll(".row").length).toBe(10);
    } finally { m.unmount(); }
  });

  it("forwards scroll.mode: the list goes synthetic and draws its scrollbar", async () => {
    const m = await mount(() => useVList<Row>({ items: rows(100), item: { height: 40, template }, scroll: { mode: "synthetic" } }));
    try {
      // The driver loads on first need: wait for the handoff.
      const vp = m.host.querySelector<HTMLElement>(".vlist-viewport")!;
      for (let i = 0; i < 200 && vp.style.touchAction !== "pan-x pinch-zoom"; i++) await flush();
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
      expect(m.host.querySelectorAll(".vlist-scrollbar")).toHaveLength(1);
    } finally { m.unmount(); }
  });
});

describe("vlist/vue useVListEvent", () => {
  it("receives the list's events until unmount", async () => {
    const clicked: string[] = [];
    const m = await mount(() => {
      const r = useVList<Row>({ item: { height: 40, template }, items: rows(10) });
      useVListEvent(r.instance, "item:click", ({ item }) => { clicked.push(item.id); });
      return r;
    });
    const row = m.host.querySelector<HTMLElement>('[data-index="2"]')!;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["row-2"]);
    m.unmount();
  });

  it("unsubscribes on unmount, registered during setup", async () => {
    let offs = 0;
    const counting: typeof createVList = (config, plugins) => {
      const list = createVList(config, plugins);
      const on = list.on.bind(list);
      list.on = ((event, handler) => {
        const off = on(event, handler);
        return () => { offs++; off(); };
      }) as typeof list.on;
      return list;
    };
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
    try {
      const m = await mount(() => {
        const r = useVList<Row>({ item: { height: 40, template }, items: rows(10) }, [], counting);
        useVListEvent(r.instance, "item:click", () => {});
        return r;
      });
      m.unmount();
    } finally {
      console.warn = warn;
    }
    expect(offs).toBe(1);
    expect(warnings).toEqual([]);
  });
});
