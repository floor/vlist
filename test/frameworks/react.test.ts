/**
 * vlist/react — real render tests (#328).
 *
 * Mounts components that call `useVList` into the process-wide happy-dom via
 * react-dom, lets the effect create a real vlist, and asserts it virtualizes,
 * updates, tears down, and runs the features it is given — and only those.
 * Ported from vlist-react, with features passed explicitly instead of as
 * config fields. No JSX, so the suite's tsconfig compiles it as is.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useVList, useVListEvent } from "../../src/react";
import { autosize, createVList, grid, selection, type VListItem } from "../../src/index";
import { capturePrototypeGeometry } from "../helpers/geometry";

interface Row extends VListItem {
  id: string;
}

const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));
const template = (r: Row): string => `<div class="row" data-id="${r.id}">${r.id}</div>`;

const VIEWPORT_H = 500;
const VIEWPORT_W = 300;

// File-wide globals, set before and restored after every test here: the
// prototype geometry, ResizeObserver, requestAnimationFrame and React's act
// flag. happy-dom does not lay out, so vlist would measure a 0px viewport.
let geometry: ReturnType<typeof capturePrototypeGeometry>;
let realRO: typeof ResizeObserver;
let realRAF: typeof requestAnimationFrame;
const actFlag = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
let realActFlag: boolean | undefined;

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
  realActFlag = actFlag.IS_REACT_ACT_ENVIRONMENT;
  // act() flushes effects deterministically only with this flag.
  actFlag.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  geometry.restore();
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRAF;
  actFlag.IS_REACT_ACT_ENVIRONMENT = realActFlag;
});

/** Mount an element, flushing effects and the rAF-scheduled first render. */
async function mount(el: ReactElement): Promise<{ host: HTMLElement; root: Root; unmount: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return {
    host,
    root,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

describe("vlist/react useVList", () => {
  it("mounts and virtualizes a large list", async () => {
    let getInstance: (() => unknown) | null = null;
    function List() {
      const hook = useVList<Row>({ item: { height: 40, template }, items: rows(1000) });
      getInstance = hook.getInstance;
      return createElement("div", { ref: hook.containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      expect(getInstance!()).not.toBeNull();
      const rendered = m.host.querySelectorAll(".row");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(100);
    } finally { await m.unmount(); }
  });

  it("updates the list when config.items changes", async () => {
    let setCount: ((n: number) => void) | null = null;
    function List() {
      const [count, set] = useState(3);
      setCount = set;
      const { containerRef } = useVList<Row>({ item: { height: 40, template }, items: rows(count) });
      return createElement("div", { ref: containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      expect(m.host.querySelectorAll(".row").length).toBe(3);
      await act(async () => { setCount!(5); });
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
      expect(m.host.querySelectorAll(".row").length).toBe(5);
    } finally { await m.unmount(); }
  });

  it("destroys the instance on unmount", async () => {
    let getInstance: (() => { destroy(): void } | null) | null = null;
    function List() {
      const hook = useVList<Row>({ item: { height: 40, template }, items: rows(100) });
      getInstance = hook.getInstance;
      return createElement("div", { ref: hook.containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    const instance = getInstance!()!;
    let destroyed = 0;
    const destroy = instance.destroy.bind(instance);
    instance.destroy = () => { destroyed++; destroy(); };
    await m.unmount();
    expect(destroyed).toBe(1);
    expect(getInstance!()).toBeNull();
  });

  it("#119: runs the plugins it is given, autosize included", async () => {
    let getInstance: (() => unknown) | null = null;
    function List() {
      const hook = useVList<Row>(
        { item: { estimatedHeight: 200, template }, items: rows(200) },
        [autosize(), selection({ mode: "single" })],
      );
      getInstance = hook.getInstance;
      return createElement("div", { ref: hook.containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      expect(getInstance!()).not.toBeNull();
      expect(m.host.querySelectorAll(".row").length).toBeGreaterThan(0);
    } finally { await m.unmount(); }
  });

  it("a feature passed explicitly works: grid lays out columns, selection selects", async () => {
    let select: ((...ids: Array<string | number>) => void) | undefined;
    let selected: (() => Array<string | number>) | undefined;
    function List() {
      const { containerRef, instanceRef } = useVList(
        { item: { height: 40, template }, items: rows(40) },
        [grid<Row>({ columns: 4 }), selection<Row>({ mode: "multiple" })],
      );
      // Typed from the plugins passed: no cast for select().
      select = (...ids) => instanceRef.current?.select(...ids);
      selected = () => instanceRef.current?.getSelected() ?? [];
      return createElement("div", { ref: containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      const items = [...m.host.querySelectorAll<HTMLElement>(".vlist-grid-item")];
      expect(items.length).toBeGreaterThan(4);
      // Four columns: the first four items share a row (same translateY), the fifth starts the next.
      const ys = items.slice(0, 5).map((el) => el.style.transform.match(/,\s*([-\d.]+)px/)?.[1] ?? el.style.transform);
      expect(new Set(ys.slice(0, 4)).size).toBe(1);
      expect(ys[4]).not.toBe(ys[0]);
      await act(async () => { select!("row-2"); });
      expect(selected!()).toEqual(["row-2"]);
    } finally { await m.unmount(); }
  });

  it("the instance carries only the methods of the plugins passed (types)", () => {
    function Typed() {
      const withSelection = useVList(
        { item: { height: 40, template }, items: rows(1) },
        [selection<Row>()],
      );
      withSelection.instanceRef.current?.select("a");
      const plain = useVList({ item: { height: 40, template }, items: rows(1) }, []);
      // @ts-expect-error select() comes from selection(), which was not passed
      plain.instanceRef.current?.select("a");
      return null;
    }
    expect(typeof Typed).toBe("function");
  });

  it("uses the advanced `create` argument with the config and plugins", async () => {
    const calls: Array<{ plugins: string[]; hasContainer: boolean }> = [];
    const create: typeof createVList = ((config: Parameters<typeof createVList>[0], plugins: Parameters<typeof createVList>[1]) => {
      calls.push({ plugins: (plugins ?? []).map((p) => p.name), hasContainer: !!config.container });
      return createVList(config, plugins);
    }) as typeof createVList;
    function List() {
      const { containerRef } = useVList<Row>({ item: { height: 40, template }, items: rows(10) }, [selection<Row>()], create);
      return createElement("div", { ref: containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      expect(calls).toEqual([{ plugins: ["selection"], hasContainer: true }]);
      expect(m.host.querySelectorAll(".row").length).toBe(10);
    } finally { await m.unmount(); }
  });

  it("forwards scroll.mode: the list goes synthetic and draws its scrollbar", async () => {
    function List() {
      const { containerRef } = useVList<Row>({ items: rows(100), item: { height: 40, template }, scroll: { mode: "synthetic" } });
      return createElement("div", { ref: containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      // The driver loads on first need: wait for the handoff.
      const vp = m.host.querySelector<HTMLElement>(".vlist-viewport")!;
      for (let i = 0; i < 200 && vp.style.touchAction !== "pan-x pinch-zoom"; i++) await new Promise((r) => setTimeout(r, 5));
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
      expect(m.host.querySelectorAll(".vlist-scrollbar")).toHaveLength(1);
    } finally { await m.unmount(); }
  });
});

describe("vlist/react useVListEvent", () => {
  it("receives the list's events for the component's lifetime", async () => {
    const clicked: string[] = [];
    function List() {
      const { containerRef, instanceRef } = useVList<Row>({ item: { height: 40, template }, items: rows(10) });
      useVListEvent(instanceRef, "item:click", ({ item }) => { clicked.push(item.id); });
      return createElement("div", { ref: containerRef, style: { height: VIEWPORT_H } });
    }
    const m = await mount(createElement(List));
    try {
      // The subscription runs on the effect after the instance exists: re-render once.
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
      const row = m.host.querySelector<HTMLElement>('[data-index="2"]')!;
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(clicked).toEqual(["row-2"]);
    } finally { await m.unmount(); }
  });
});
