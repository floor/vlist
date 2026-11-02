import { beforeAll, afterAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { scoped, waitFor, type TestScope } from "../helpers/scope";
import { createVList } from "../../src/core/create";
import { grid, type GridMethods } from "../../src/plugins/grid/plugin";
import { masonry, type MasonryMethods } from "../../src/plugins/masonry/plugin";
import { carousel, type CarouselMethods } from "../../src/plugins/carousel/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { snapshots, type SnapshotsMethods } from "../../src/plugins/snapshots/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import { data } from "../../src/plugins/data/plugin";
import type { VList, VListPlugin } from "../../src/core/types";

interface Row { id: number; label: string; }
const rows = (count = 100, start = 0): Row[] => Array.from({ length: count }, (_, i) => ({ id: start + i, label: `Item ${start + i}` }));
let geometry: ReturnType<typeof capturePrototypeGeometry>;
const observers = new WeakMap<Element, ResizeObserverCallback>();
let savedObserver: typeof ResizeObserver;
beforeAll(() => {
  setupDOM(); geometry = capturePrototypeGeometry(); savedObserver = globalThis.ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  globalThis.ResizeObserver = class implements ResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element): void { observers.set(target, this.callback); }
    unobserve(target: Element): void { observers.delete(target); }
    disconnect(): void {}
  };
});
afterAll(() => { globalThis.ResizeObserver = savedObserver; geometry.restore(); teardownDOM(); geometry.assertRestored(); });

type Layout = "grid" | "masonry";
function fixture(scope: TestScope, kind: Layout, horizontal = false, extra: VListPlugin<Row>[] = [], heights?: number[]) {
  const container = createContainer({ width: 600, height: 400 });
  const spec = heights ? (i: number): number => heights[i] ?? 40 : 40;
  const plugin = kind === "grid" ? grid<Row>({ columns: 3, gap: 8 }) : masonry<Row>({ columns: 3, gap: 8 });
  const list = createVList({ container, items: rows(), orientation: horizontal ? "horizontal" : "vertical", scroll: { mode: "native" },
    item: { width: spec, height: spec, template: (row: Row) => row.label },
  }, [plugin, ...extra]) as VList<Row> & GridMethods & MasonryMethods & SnapshotsMethods;
  scope.own(list, container);
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  let width = 600, height = 400, position = 0;
  Object.defineProperty(viewport, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, get: () => height });
  const extent = (): number => horizontal ? width : height;
  const max = (): number => Math.max(0, (parseFloat(content.style[horizontal ? "width" : "height"]) || 0) - extent());
  Object.defineProperty(viewport, horizontal ? "scrollLeft" : "scrollTop", { configurable: true,
    get: () => Math.min(position, max()), set: (value: number) => { position = Math.max(0, Math.min(value, max())); },
  });
  const resize = async (w: number, h: number): Promise<void> => {
    await waitFor(() => observers.has(viewport), "layout resize observer"); width = w; height = h;
    observers.get(viewport)!([{ target: viewport, contentRect: new DOMRect(0, 0, w, h), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as ResizeObserverEntry], {} as ResizeObserver);
  };
  return { list, container, viewport, content, extent, max, resize,
    rendered: () => [...content.querySelectorAll<HTMLElement>("[data-id]")],
    native: () => horizontal ? viewport.scrollLeft : viewport.scrollTop,
    row: (id: number) => content.querySelector<HTMLElement>(`[data-id="${id}"]`),
  };
}

for (const kind of ["grid", "masonry"] as const) for (const horizontal of [false, true]) {
  const axis = horizontal ? "horizontal" : "vertical";
  it(`${kind} ${axis}: empty replacement removes all rendered items`, scoped(scope => {
    const f = fixture(scope, kind, horizontal); f.list.scrollToIndex(80); expect(f.rendered().length).toBeGreaterThan(0);
    f.list.setItems([]); expect(f.rendered().length).toBe(0); expect(f.list.total).toBe(0);
  }));
  it(`${kind} ${axis}: shorter replacement synchronizes the native source and paints reachable items`, scoped(scope => {
    const f = fixture(scope, kind, horizontal); f.list.scrollToIndex(80); f.list.setItems(rows(2, 1000));
    expect(f.native()).toBe(0); expect(f.list.getScrollPosition()).toBe(0); expect(f.row(1000)).not.toBeNull(); expect(f.row(1001)).not.toBeNull();
    expect(f.rendered().every(row => Number(row.dataset.id) >= 1000)).toBe(true);
  }));
  it(`${kind} ${axis}: append and same-count replacement preserve the scrolled position`, scoped(scope => {
    const f = fixture(scope, kind, horizontal); f.list.scrollToIndex(50); const pos = f.list.getScrollPosition(); const row = f.row(50);
    expect(row).not.toBeNull(); const transform = row!.style.transform;
    f.list.appendItems(rows(13, 100)); expect(f.list.getScrollPosition()).toBe(pos); expect(f.row(50)!.style.transform).toBe(transform);
    f.list.setItems(rows(113, 1000)); expect(f.list.getScrollPosition()).toBe(pos); expect(f.content.textContent).toContain("Item 1050");
  }));
  it(`${kind} ${axis}: final partial row and out-of-range scroll targets remain reachable`, scoped(scope => {
    const f = fixture(scope, kind, horizontal); f.list.setItems(rows(97)); f.list.scrollToIndex(999, "end");
    expect(f.row(96)).not.toBeNull(); expect(f.list.getScrollPosition()).toBeLessThanOrEqual(f.max());
    f.list.scrollToIndex(-10); expect(f.row(0)).not.toBeNull(); expect(f.list.getScrollPosition()).toBe(0);
  }));
}

for (const horizontal of [false, true]) {
  it(`grid ${horizontal ? "horizontal" : "vertical"}: middle-of-row instant and smooth navigation`, scoped(async scope => {
    const f = fixture(scope, "grid", horizontal); f.list.scrollToIndex(62); expect(f.list.getScrollPosition()).toBe(20 * 48);
    f.list.scrollToIndex(65, { behavior: "smooth", duration: 30 });
    await waitFor(() => f.list.getScrollPosition() === 21 * 48, "grid smooth row"); expect(f.row(65)).not.toBeNull();
  }));
  it(`grid ${horizontal ? "horizontal" : "vertical"}: column update preserves the visible item and its offset`, scoped(scope => {
    const f = fixture(scope, "grid", horizontal); f.list.scrollToIndex(60); const offset = f.list.getScrollPosition();
    f.list.updateGrid({ columns: 2 });
    expect(f.row(60)).not.toBeNull(); expect(f.list.getScrollPosition()).toBe(30 * 48); expect(f.list.getScrollPosition()).not.toBe(offset);
  }));
  it(`grid ${horizontal ? "horizontal" : "vertical"}: unchanged-layout snapshot restores the same position`, scoped(async scope => {
    const f = fixture(scope, "grid", horizontal, [snapshots<Row>()]); f.list.scrollToIndex(60); const snap = f.list.getScrollSnapshot();
    f.list.scrollToIndex(0); await f.list.restoreScroll(snap); expect(f.list.getScrollPosition()).toBe(20 * 48); expect(f.row(60)).not.toBeNull();
  }));
}

for (const owner of ["selection", "a11y"] as const) for (const horizontal of [false, true]) {
  // Own document.activeElement and dispatch keyboard events serially.
  it.serial(`grid ${owner} ${horizontal ? "horizontal" : "vertical"}: keyboard crosses rows and retains option semantics`, scoped(scope => {
    const f = fixture(scope, "grid", horizontal, [owner === "selection" ? selection<Row>({ mode: "single" }) : a11y<Row>()]);
    const key = (key: string): void => { f.content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
    const focused = (): HTMLElement | null => f.content.querySelector(".vlist-item--focused");
    key("Home"); expect(focused()?.dataset.id).toBe("0");
    key(horizontal ? "ArrowDown" : "ArrowRight"); key(horizontal ? "ArrowDown" : "ArrowRight"); key(horizontal ? "ArrowDown" : "ArrowRight");
    expect(focused()?.dataset.id).toBe("3"); key("End"); expect(focused()?.dataset.id).toBe("99");
    expect(focused()?.getAttribute("role")).toBe("option"); expect(focused()?.getAttribute("aria-posinset")).toBe("100");
    expect(f.content.getAttribute("aria-activedescendant")).toBe(focused()!.id); key("PageUp"); expect(Number(focused()?.dataset.id)).toBeLessThan(99);
  }));
}

it("grid groups: navigation reaches a data item without selecting a header", scoped(async scope => {
  const f = fixture(scope, "grid", false, [groups<Row>({ getGroupForIndex: i => i < 50 ? "A" : "B", header: { height: 30, template: key => key } })]);
  await Promise.resolve(); f.list.scrollToIndex(60); expect(f.row(60)).not.toBeNull(); expect(f.list.getItemAt(60)?.id).toBe(60);
}));

it("masonry: uneven appended items keep prior placements while scrolled", scoped(scope => {
  const heights = Array.from({ length: 100 }, (_, i) => [30, 400, 70, 150][i % 4]!);
  const f = fixture(scope, "masonry", false, [], heights); f.list.scrollToIndex(50); const pos = f.list.getScrollPosition(); const transform = f.row(50)!.style.transform;
  heights.push(1000, 20, 700); f.list.appendItems(rows(3, 100)); expect(f.list.getScrollPosition()).toBe(pos); expect(f.row(50)!.style.transform).toBe(transform);
  f.list.scrollToIndex(102); expect(f.row(102)).not.toBeNull();
}));

it("masonry: cross-size resize and column change produce correctly sized placements", scoped(async scope => {
  const f = fixture(scope, "masonry"); await f.resize(900, 400); f.list.updateMasonry({ columns: 4 });
  expect(f.list.getMasonryLayout().columns).toBe(4); expect(f.row(0)!.style.width).toBe("219px");
}));

it("masonry data: resolved async rows replace placeholders at their layout positions", scoped(async scope => {
  const container = createContainer();
  const list = createVList<Row>({ container, item: { height: 60, template: row => row.label ?? "loading" } }, [masonry<Row>({ columns: 3 }), data<Row>({ adapter: { read: async ({ offset, limit }) => ({ items: rows(Math.min(limit, 90 - offset), offset), total: 90, hasMore: offset + limit < 90 }) } })]);
  scope.own(list, container); await waitFor(() => list.total === 90 && !!container.querySelector('[data-id="0"]'), "masonry data rows");
  list.scrollToIndex(60); await waitFor(() => !!container.querySelector('[data-id="60"]'), "masonry async target"); expect(container.textContent).toContain("Item 60");
}));

function animationClock(scope: TestScope) {
  const raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>(); let next = 0; let now = performance.now();
  globalThis.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
  scope.defer(() => { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf; });
  return { step(ms = 1000): void { now += ms; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); }, pending: () => frames.size };
}
function carouselList(scope: TestScope, horizontal: boolean, variant: "full" | "hero" | "multi" | "free" = "full", extra: VListPlugin<Row>[] = []) {
  const container = createContainer();
  const list = createVList({ container, items: rows(10), orientation: horizontal ? "horizontal" : "vertical", item: { height: 100, width: 100, template: (row: Row) => row.label } }, [carousel<Row>({ variant, initialIndex: 2, peek: "20%" }), ...extra]) as VList<Row> & CarouselMethods & SnapshotsMethods;
  scope.own(list, container); return { list, container };
}

for (const horizontal of [false, true]) for (const variant of ["full", "hero", "multi"] as const) {
  // Own the process-wide rAF queue while inspecting interrupted transitions.
  it.serial(`carousel ${variant} ${horizontal ? "horizontal" : "vertical"}: replacement during transition cancels the old slide target`, scoped(scope => {
    const clock = animationClock(scope); const f = carouselList(scope, horizontal, variant); clock.step();
    f.list.goTo(8, { behavior: "smooth", duration: 100 }); clock.step(20); f.list.setItems(rows(1, 1000)); clock.step();
    expect(f.list.total).toBe(1); expect(f.list.getCarouselState().index).toBe(0); expect(f.container.textContent).toContain("Item 1000");
  }));
  // Own rAF: replacing items must preserve a valid destination even at the same count.
  it.serial(`carousel ${variant} ${horizontal ? "horizontal" : "vertical"}: same-count replacement keeps the active window rendered`, scoped(scope => {
    const clock = animationClock(scope); const f = carouselList(scope, horizontal, variant); clock.step();
    f.list.goTo(6); f.list.setItems(rows(10, 1000));
    expect(f.list.total).toBe(10); expect(f.list.getCarouselState().index).toBe(6);
    expect(f.container.textContent).toContain("Item 1006");
    f.list.setItems(rows(2, 2000)); expect(f.list.getCarouselState().index).toBe(0); expect(f.container.textContent).toContain("Item 2000");
  }));
  // Own the rAF queue and per-viewport ResizeObserver callback.
  it.serial(`carousel ${variant} ${horizontal ? "horizontal" : "vertical"}: resize during transition retains the intended slide`, scoped(async scope => {
    const clock = animationClock(scope); const f = carouselList(scope, horizontal, variant); clock.step();
    const viewport = f.container.querySelector<HTMLElement>(".vlist-viewport")!; await waitFor(() => observers.has(viewport), "carousel observer");
    f.list.goTo(8, { behavior: "smooth", duration: 100 }); clock.step(20);
    observers.get(viewport)!([{ target: viewport, contentRect: new DOMRect(0, 0, horizontal ? 900 : 600, horizontal ? 400 : 800), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as ResizeObserverEntry], {} as ResizeObserver);
    clock.step(); expect(f.list.getCarouselState().index).toBe(8);
  }));
}

for (const horizontal of [false, true]) {
  it(`carousel ${horizontal ? "horizontal" : "vertical"}: next/previous wrap and negative goTo normalizes`, scoped(scope => {
    const f = carouselList(scope, horizontal); f.list.goTo(9); f.list.next(1, { behavior: "auto" }); expect(f.list.getCarouselState().index).toBe(0);
    f.list.prev(1, { behavior: "auto" }); expect(f.list.getCarouselState().index).toBe(9); f.list.goTo(-1); expect(f.list.getCarouselState().index).toBe(9);
  }));
  it(`carousel ${horizontal ? "horizontal" : "vertical"}: empty replacement is safe and refill is navigable`, scoped(scope => {
    const f = carouselList(scope, horizontal); f.list.goTo(7); f.list.setItems([]); expect(f.list.total).toBe(0); expect(f.list.getCarouselState().index).toBe(0);
    f.list.setItems(rows(3, 1000)); f.list.goTo(2); expect(f.list.getCarouselState().index).toBe(2); expect(f.container.textContent).toContain("Item 1002");
  }));
  it(`carousel ${horizontal ? "horizontal" : "vertical"}: unchanged layout snapshot restores the same slide`, scoped(async scope => {
    const f = carouselList(scope, horizontal, "full", [snapshots<Row>()]); f.list.goTo(6); const snap = f.list.getScrollSnapshot();
    f.list.goTo(1); await f.list.restoreScroll(snap); expect(f.list.getCarouselState().index).toBe(6);
  }));
}

for (const kind of ["grid", "masonry", "carousel"] as const) {
  it(`${kind}: autosize conflict is clear in either order`, scoped(scope => {
    const container = createContainer(); scope.defer(() => container.remove());
    for (const reverse of [false, true]) {
      const layout = kind === "grid" ? grid<Row>({ columns: 3 }) : kind === "masonry" ? masonry<Row>({ columns: 3 }) : carousel<Row>();
      const plugins = [layout, autosize<Row>()];
      expect(() => createVList({ container, items: rows(), item: { height: 40, template: (row: Row) => row.label } }, reverse ? plugins.reverse() : plugins)).toThrow(`Plugin "${kind}" conflicts with "autosize"`);
    }
  }));
}


for (const horizontal of [false, true]) {
  it(`masonry ${horizontal ? "horizontal" : "vertical"}: column update preserves a visible item`, scoped(scope => {
    const f = fixture(scope, "masonry", horizontal); f.list.scrollToIndex(60); f.list.updateMasonry({ columns: 2 });
    expect(f.row(60)).not.toBeNull(); expect(f.list.getScrollPosition()).toBe(30 * 48);
  }));
  it(`carousel free ${horizontal ? "horizontal" : "vertical"}: same-count replacement refreshes variable step sizes`, scoped(scope => {
    let sizes = [100, 200, 150]; const container = createContainer();
    const list = createVList({ container, items: rows(3), orientation: horizontal ? "horizontal" : "vertical", item: { height: i => sizes[i]!, width: i => sizes[i]!, template: (row: Row) => row.label } }, [carousel<Row>({ variant: "free" })]) as VList<Row> & CarouselMethods;
    scope.own(list, container); list.goTo(1); expect(list.getCarouselState().scrollPosition).toBe(100);
    sizes = [200, 150, 75]; list.setItems(rows(3, 1000)); expect(list.getCarouselState().scrollPosition).toBe(200); expect(container.textContent).toContain("Item 1001");
  }));
}

for (const owner of ["a11y", "selection"] as const) for (const variant of ["full", "free"] as const) {
  // Own document.activeElement and the rAF queue for keyboard wrap assertions.
  it.serial(`carousel ${variant} ${owner}: keyboard wrap keeps logical focus and active descendant`, scoped(async scope => {
    const clock = animationClock(scope); const f = carouselList(scope, true, variant, [owner === "selection" ? selection<Row>({ mode: "single" }) : a11y<Row>()]); clock.step();
    const content = f.container.querySelector<HTMLElement>(".vlist-content")!;
    const press = async (key: string): Promise<void> => { content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); clock.step(); await Promise.resolve(); };
    await press("End"); expect(f.list.getCarouselState().index).toBe(9); await press("ArrowRight"); expect(f.list.getCarouselState().index).toBe(0);
    const focus = [...content.querySelectorAll<HTMLElement>(".vlist-item--focused")].find(el => el.style.display !== "none"); expect(focus?.dataset.id).toBe("0"); expect(content.getAttribute("aria-activedescendant")).toBe(focus!.id);
  }));
}

it("masonry: destroy before a queued resize leaves no mounted items", scoped(async scope => {
  const f = fixture(scope, "masonry"); await waitFor(() => observers.has(f.viewport), "masonry observer"); const callback = observers.get(f.viewport)!;
  f.list.destroy(); expect(f.list.element.isConnected).toBe(false);
  expect(() => callback([{ target: f.viewport, contentRect: new DOMRect(0, 0, 900, 600), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], {} as ResizeObserver)).not.toThrow();
  expect(f.list.element.querySelectorAll("[data-id]").length).toBe(0);
}));

// groups() caches its own column geometry; refreshing that owner needs a separate change.
for (const kind of ["grid", "masonry"] as const) {
  it.todo(`${kind} groups: column updates refresh the grouped layout`, scoped(async scope => {
    const f = fixture(scope, kind, false, [groups<Row>({ getGroupForIndex: i => i < 50 ? "A" : "B", header: { height: 30, template: key => key } })]);
    await Promise.resolve();
    if (kind === "grid") f.list.updateGrid({ columns: 2 });
    else f.list.updateMasonry({ columns: 2 });
    expect(f.row(0)).not.toBeNull();
    expect(f.row(0)?.style.width).toBe("296px");
  }));
}
