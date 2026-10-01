/**
 * vlist/solid — real render tests (#328).
 *
 * Mounts components that call `createVList` into the process-wide happy-dom
 * via solid-js/web, lets onMount create a real vlist, and asserts it
 * virtualizes, updates, tears down, and runs the features it is given — and
 * only those. Ported from vlist-solidjs, with features passed explicitly
 * instead of as config fields. No JSX: components return the DOM node.
 *
 * Solid's browser build is required (its server build never runs onMount);
 * test/preload.ts serves it to `bun test`.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createSignal, type Accessor } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createVList, createVListEvent, type CreateVListConfigInput } from "../../src/solid";
import { autosize, createVList as createCoreVList, grid, selection, type VList, type VListItem } from "../../src/index";
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

/** A div for the list, handed to `setRef` as `ref={setRef}` would. */
function listDiv(setRef: (el: HTMLDivElement) => void): HTMLDivElement {
  const div = document.createElement("div");
  div.style.height = `${VIEWPORT_H}px`;
  setRef(div);
  return div;
}

/** Render a component, flushing onMount and the rAF-scheduled first render. */
async function mount(component: () => HTMLElement): Promise<{ host: HTMLElement; dispose: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const disposeRoot = render(component, host);
  await flush();
  return {
    host,
    dispose: (): void => {
      disposeRoot();
      host.remove();
    },
  };
}

const base = (n: number): CreateVListConfigInput<Row> => ({ item: { height: 40, template }, items: rows(n) });

describe("vlist/solid createVList", () => {
  it("runs Solid's browser build", () => {
    expect(isServer).toBe(false);
  });

  it("mounts and virtualizes a large list", async () => {
    let instance: Accessor<VList<Row> | null> = () => null;
    const m = await mount(() => {
      const api = createVList<Row>(() => base(1000));
      instance = api.instance;
      return listDiv(api.setRef);
    });
    try {
      expect(instance()).not.toBeNull();
      const rendered = m.host.querySelectorAll(".row");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(100);
    } finally { m.dispose(); }
  });

  it("updates the list when the config's items change", async () => {
    const [count, setCount] = createSignal(3);
    const m = await mount(() => listDiv(createVList<Row>(() => base(count())).setRef));
    try {
      expect(m.host.querySelectorAll(".row").length).toBe(3);
      setCount(5);
      await flush();
      expect(m.host.querySelectorAll(".row").length).toBe(5);
    } finally { m.dispose(); }
  });

  it("tears down the instance on dispose", async () => {
    let instance: Accessor<VList<Row> | null> = () => null;
    const m = await mount(() => {
      const api = createVList<Row>(() => base(100));
      instance = api.instance;
      return listDiv(api.setRef);
    });
    const list = instance();
    expect(list).not.toBeNull();
    const destroyed: unknown[] = [];
    list!.on("destroy", () => destroyed.push(true));
    m.dispose();
    expect(instance()).toBeNull();
    expect(destroyed).toHaveLength(1);
  });

  it("#119: runs the plugins it is given, autosize included", async () => {
    let names: string[] = [];
    const create: typeof createCoreVList = ((config, plugins) => {
      names = (plugins ?? []).map((p) => p.name);
      return createCoreVList(config, plugins);
    }) as typeof createCoreVList;
    const m = await mount(() => listDiv(createVList<Row>(
      () => ({ item: { estimatedHeight: 200, template }, items: rows(200) }),
      [autosize(), selection({ mode: "single" })],
      create,
    ).setRef));
    try {
      expect(names).toEqual(["autosize", "selection"]);
      expect(m.host.querySelectorAll(".row").length).toBeGreaterThan(0);
    } finally { m.dispose(); }
  });

  it("a feature passed explicitly works: grid lays out columns, selection selects", async () => {
    let select: ((...ids: Array<string | number>) => void) | undefined;
    let selected: (() => Array<string | number>) | undefined;
    const m = await mount(() => {
      const { setRef, instance } = createVList(
        () => base(40),
        [grid<Row>({ columns: 4 }), selection<Row>({ mode: "multiple" })],
      );
      // Typed from the plugins passed: no cast for select().
      select = (...ids) => instance()?.select(...ids);
      selected = () => instance()?.getSelected() ?? [];
      return listDiv(setRef);
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
    } finally { m.dispose(); }
  });

  it("the instance carries only the methods of the plugins passed (types)", () => {
    const typed = (): void => {
      const withSelection = createVList(() => base(1), [selection<Row>()]);
      withSelection.instance()?.select("a");
      const plain = createVList(() => base(1), []);
      // @ts-expect-error select() comes from selection(), which was not passed
      plain.instance()?.select("a");
    };
    expect(typeof typed).toBe("function");
  });

  it("uses the advanced `create` argument with the config and plugins", async () => {
    // Containers are kept by reference and compared by identity: a failing
    // toEqual on a DOM node never finishes printing its diff.
    const calls: Array<{ plugins: string[]; container: unknown }> = [];
    const create: typeof createCoreVList = ((config, plugins) => {
      calls.push({ plugins: (plugins ?? []).map((p) => p.name), container: config.container });
      return createCoreVList(config, plugins);
    }) as typeof createCoreVList;
    let div: HTMLDivElement | null = null;
    const m = await mount(() => (div = listDiv(createVList<Row>(() => base(10), [selection<Row>()], create).setRef)));
    try {
      expect(calls.map((c) => c.plugins)).toEqual([["selection"]]);
      expect(calls[0]!.container === div).toBe(true);
      expect(m.host.querySelectorAll(".row").length).toBe(10);
    } finally { m.dispose(); }
  });

  it("with the synthetic factory as `create`, the list takes synthetic input", async () => {
    const m = await mount(() => listDiv(createVList<Row>(
      () => base(100),
      [],
      createSyntheticVList as typeof createCoreVList,
    ).setRef));
    try {
      const vp = m.host.querySelector<HTMLElement>(".vlist-viewport")!;
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
    } finally { m.dispose(); }
  });

  it("forwards scroll.mode: the list goes synthetic and draws its scrollbar", async () => {
    const m = await mount(() => listDiv(createVList<Row>(() => ({ ...base(100), scroll: { mode: "synthetic" } })).setRef));
    try {
      // The driver loads on first need: wait for the handoff.
      const vp = m.host.querySelector<HTMLElement>(".vlist-viewport")!;
      for (let i = 0; i < 200 && vp.style.touchAction !== "pan-x pinch-zoom"; i++) await flush();
      expect(vp.style.touchAction).toBe("pan-x pinch-zoom");
      expect(m.host.querySelectorAll(".vlist-scrollbar")).toHaveLength(1);
    } finally { m.dispose(); }
  });
});

describe("vlist/solid createVListEvent", () => {
  it("receives the list's events for the component's lifetime", async () => {
    const clicked: string[] = [];
    const m = await mount(() => {
      const { setRef, instance } = createVList<Row>(() => base(10));
      createVListEvent(instance, "item:click", ({ item }) => { clicked.push(item.id); });
      return listDiv(setRef);
    });
    const row = m.host.querySelector<HTMLElement>('[data-index="2"]')!;
    const click = (): void => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); };
    click();
    expect(clicked).toEqual(["row-2"]);
    // Unsubscribed with the component: the list and its listener go with it.
    m.dispose();
    click();
    expect(clicked).toEqual(["row-2"]);
  });
});
