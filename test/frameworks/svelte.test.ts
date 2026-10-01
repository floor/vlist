/**
 * vlist/svelte — action tests (#328).
 *
 * The action is plain DOM code, so these call it on a node directly, as
 * Svelte's `use:` does, in the process-wide happy-dom. They assert it
 * virtualizes, updates, tears down, and runs the features it is given — and
 * only those. Ported from vlist-svelte, with features passed explicitly
 * instead of as config fields.
 */
import { describe, it as baseIt, expect, beforeAll, afterAll } from "bun:test";

// Serial under `bun test --concurrent`: every test here mounts into the one
// document, swaps the same globals (geometry, ResizeObserver, rAF) and, for
// React, drives one act() queue that does not allow overlapping calls.
const it = baseIt.serial;
import { vlist, onVListEvent, type VListActionConfig, type VListActionOptions } from "../../src/svelte";
import { autosize, createVList, grid, selection, type VList, type VListItem, type VListPlugin } from "../../src/index";
import { createVList as createSyntheticVList } from "../../src/synthetic";
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
  geometry.assertRestored();
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRAF;
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** Run the action on a fresh node, as `use:vlist` does, and flush the first render. */
async function apply<const P extends readonly VListPlugin<Row, any>[] = VListPlugin<Row>[]>(
  options: VListActionOptions<Row, P>,
) {
  const node = document.createElement("div");
  node.style.height = `${VIEWPORT_H}px`;
  document.body.appendChild(node);
  const action = vlist<Row, P>(node, options);
  await flush();
  return {
    node,
    action,
    destroy: (): void => {
      action.destroy();
      node.remove();
    },
  };
}

const base = (n: number): VListActionConfig<Row> => ({ item: { height: 40, template }, items: rows(n) });

describe("vlist/svelte action", () => {
  it("mounts and virtualizes a large list", async () => {
    const m = await apply({ config: base(1000) });
    try {
      const rendered = m.node.querySelectorAll(".row");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(100);
    } finally { m.destroy(); }
  });

  it("updates the list when config.items changes", async () => {
    const m = await apply({ config: base(3) });
    try {
      expect(m.node.querySelectorAll(".row").length).toBe(3);
      m.action.update({ config: base(5) });
      await flush();
      expect(m.node.querySelectorAll(".row").length).toBe(5);
    } finally { m.destroy(); }
  });

  it("tears down the list on destroy", async () => {
    let instance: VList<Row> | null = null;
    const m = await apply({ config: base(100), onInstance: (list) => { instance = list; } });
    expect(instance).not.toBeNull();
    expect(m.node.querySelectorAll(".row").length).toBeGreaterThan(0);
    const destroyed: unknown[] = [];
    onVListEvent(instance!, "destroy", () => destroyed.push(true));
    m.destroy();
    expect(destroyed).toHaveLength(1);
    expect(m.node.querySelectorAll(".row").length).toBe(0);
  });

  it("#119: runs the plugins it is given, autosize included", async () => {
    let names: string[] = [];
    const create: typeof createVList = ((config, plugins) => {
      names = (plugins ?? []).map((p) => p.name);
      return createVList(config, plugins);
    }) as typeof createVList;
    const m = await apply({
      config: { item: { estimatedHeight: 200, template }, items: rows(200) },
      plugins: [autosize(), selection({ mode: "single" })],
      create,
    });
    try {
      expect(names).toEqual(["autosize", "selection"]);
      expect(m.node.querySelectorAll(".row").length).toBeGreaterThan(0);
    } finally { m.destroy(); }
  });

  it("a feature passed explicitly works: grid lays out columns, selection selects", async () => {
    let select: ((...ids: Array<string | number>) => void) | undefined;
    let selected: (() => Array<string | number>) | undefined;
    const m = await apply({
      config: base(40),
      plugins: [grid<Row>({ columns: 4 }), selection<Row>({ mode: "multiple" })],
      // Typed from the plugins passed: no cast for select().
      onInstance: (list) => {
        select = (...ids) => list.select(...ids);
        selected = () => list.getSelected();
      },
    });
    try {
      const items = [...m.node.querySelectorAll<HTMLElement>(".vlist-grid-item")];
      expect(items.length).toBeGreaterThan(4);
      // Four columns: the first four items share a row (same translateY), the fifth starts the next.
      const ys = items.slice(0, 5).map((el) => el.style.transform.match(/,\s*([-\d.]+)px/)?.[1] ?? el.style.transform);
      expect(new Set(ys.slice(0, 4)).size).toBe(1);
      expect(ys[4]).not.toBe(ys[0]);
      select!("row-2");
      expect(selected!()).toEqual(["row-2"]);
    } finally { m.destroy(); }
  });

  it("the instance carries only the methods of the plugins passed (types)", () => {
    const typed = (node: HTMLElement): void => {
      vlist(node, {
        config: base(1),
        plugins: [selection<Row>()],
        onInstance: (list) => list.select("a"),
      });
      vlist(node, {
        config: base(1),
        plugins: [],
        // @ts-expect-error select() comes from selection(), which was not passed
        onInstance: (list) => list.select("a"),
      });
    };
    expect(typeof typed).toBe("function");
  });

  it("uses the advanced `create` argument with the config and plugins", async () => {
    // Containers are kept by reference and compared by identity: a failing
    // toEqual on a DOM node never finishes printing its diff.
    const calls: Array<{ plugins: string[]; container: unknown }> = [];
    const create: typeof createVList = ((config, plugins) => {
      calls.push({ plugins: (plugins ?? []).map((p) => p.name), container: config.container });
      return createVList(config, plugins);
    }) as typeof createVList;
    const m = await apply({ config: base(10), plugins: [selection<Row>()], create });
    try {
      expect(calls.map((c) => c.plugins)).toEqual([["selection"]]);
      expect(calls[0]!.container === m.node).toBe(true);
      expect(m.node.querySelectorAll(".row").length).toBe(10);
    } finally { m.destroy(); }
  });

  it("with the synthetic factory as `create`, the list takes synthetic input", async () => {
    const m = await apply({ config: base(100), create: createSyntheticVList as typeof createVList });
    try {
      const vp = m.node.querySelector<HTMLElement>(".vlist-viewport")!;
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
    } finally { m.destroy(); }
  });

  it("forwards scroll.mode: the list goes synthetic and draws its scrollbar", async () => {
    const m = await apply({ config: { ...base(100), scroll: { mode: "synthetic" } } });
    try {
      // The driver loads on first need: wait for the handoff.
      const vp = m.node.querySelector<HTMLElement>(".vlist-viewport")!;
      for (let i = 0; i < 200 && vp.style.touchAction !== "pan-x pinch-zoom"; i++) await flush();
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
      expect(m.node.querySelectorAll(".vlist-scrollbar")).toHaveLength(1);
    } finally { m.destroy(); }
  });
});

describe("vlist/svelte onVListEvent", () => {
  it("receives the list's events until unsubscribed", async () => {
    let instance: VList<Row> | null = null;
    const m = await apply({ config: base(10), onInstance: (list) => { instance = list; } });
    try {
      const clicked: string[] = [];
      const off = onVListEvent(instance!, "item:click", ({ item }) => { clicked.push(item.id); });
      const click = (): void => {
        m.node.querySelector<HTMLElement>('[data-index="2"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      };
      click();
      expect(clicked).toEqual(["row-2"]);
      off();
      click();
      expect(clicked).toEqual(["row-2"]);
    } finally { m.destroy(); }
  });
});
