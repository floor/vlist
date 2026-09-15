import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createVList as createNative } from "../../src/native";
import type { PluginContext, VList, VListPlugin } from "../../src/core/types";
import { createSyntheticScrollHandler } from "../../src/synthetic/handler";
import { createEngineState } from "../../src/core/state";
import { a11y } from "../../src/plugins/a11y";
import { selection } from "../../src/plugins/selection";
import type { ScrollSnapshot } from "../../src/types";
import { groups } from "../../src/plugins/groups";
import { table } from "../../src/plugins/table";
import { snapshots } from "../../src/plugins/snapshots";
import { autosize } from "../../src/plugins/autosize";
import { transition } from "../../src/plugins/transition";
import { scrollbar } from "../../src/plugins/scrollbar";

function factoryFor(mode: "native" | "synthetic") {
  return mode === "synthetic" ? createVList : createNative;
}

let container: HTMLElement;
let list: VList<TestItem> | undefined;
let originalHeight: PropertyDescriptor | undefined, originalWidth: PropertyDescriptor | undefined;
let raf: typeof requestAnimationFrame, caf: typeof cancelAnimationFrame;
let next = 0;
const frames = new Map<number, FrameRequestCallback>();
function frame(time: number) {
  const pending = [...frames.values()]; frames.clear();
  for (const fn of pending) fn(time);
}
beforeAll(() => {
  setupDOM();
  originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
  raf = globalThis.requestAnimationFrame; caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => { frames.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
});
afterAll(() => {
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalHeight);
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf;
  teardownDOM();
});
beforeEach(() => { container = createContainer(); frames.clear(); });
afterEach(() => { list?.destroy(); list = undefined; container.remove(); frames.clear(); });
function make(axis = "y", plugins: VListPlugin<TestItem>[] = []) {
  list = createVList<TestItem>({ container, orientation: axis === "x" ? "horizontal" : "vertical",
    items: createTestItems(1000), item: { height: 50, width: 50, template: simpleTemplate } }, plugins);
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  const captured = new Set<number>();
  viewport.hasPointerCapture = id => captured.has(id);
  viewport.setPointerCapture = id => { captured.add(id); };
  viewport.releasePointerCapture = id => { captured.delete(id); };
  Object.defineProperty(viewport, axis === "x" ? "scrollLeft" : "scrollTop", {
    configurable: true, get: () => 0, set: () => { throw new Error("native main-axis write"); },
  });
  return { viewport, content };
}
function pointer(target: Element | Window, type: string, id: number, x: number, y: number, time: number, primary = true) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: id, clientX: x, clientY: y, isPrimary: primary });
  Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event); return event;
}
function wheel(target: Element, dx: number, dy: number, mode = 0) {
  const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: dx, deltaY: dy, deltaMode: mode });
  target.dispatchEvent(e); return e;
}
function key(target: Element, value: string) {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value });
  target.dispatchEvent(e); return e;
}
function drag(target: Element, axis: string, id = 1, start = 0) {
  pointer(target, "pointerdown", id, 200, 200, start);
  pointer(target, "pointermove", id, axis === "x" ? 150 : 200, axis === "y" ? 150 : 200, start + 16);
  pointer(window, "pointerup", id, 150, 150, start + 20);
}

describe("synthetic entry and input", () => {
  it("the native entry retains native scrolling behavior", () => {
    for (const mode of ["native"] as const) {
      list = factoryFor(mode)({ container, items: createTestItems(1000), item: { height: 50, template: simpleTemplate } });
      const content = container.querySelector<HTMLElement>(".vlist-content")!;
      expect(content.style.height).toBe("50000px");
      expect(content.style.overflow).not.toBe("clip");
      list.destroy(); list = undefined;
    }
  });
  for (const axis of ["y", "x"]) {
    it(`${axis}: viewport-sized content, exact logical end, no native writes`, () => {
      const { viewport, content } = make(axis);
      expect(content.style.overflow).toBe("clip");
      expect(content.style[axis === "x" ? "width" : "height"]).toBe("100%");
      expect(viewport.style.touchAction).toBe(axis === "x" ? "pan-y pinch-zoom" : "pan-x pinch-zoom");
      list!.scrollToIndex(999, "end");
      expect(list!.getScrollPosition()).toBe(50_000 - (axis === "x" ? 300 : 500));
      const last = content.querySelector<HTMLElement>('[data-index="999"]')!;
      expect(last.style.transform).toContain(axis === "x" ? "250" : "450");
    });
    for (const tag of ["a", "button", "input"]) {
      it(`${axis}: drag begins on ${tag}, including input type button`, () => {
        const { content } = make(axis);
        const child = document.createElement(tag); if (tag === "input") (child as HTMLInputElement).type = "button";
        content.append(child); drag(child, axis);
        expect(list!.getScrollPosition()).toBe(50);
        frame(140); expect(list!.getScrollPosition()).toBe(50);
        frame(156); expect(list!.getScrollPosition()).toBeGreaterThan(50);
        list!.scrollToIndex(0); frame(172); expect(list!.getScrollPosition()).toBe(0);
      });
    }
    it(`${axis}: text/range controls keep gestures, native activation keys remain unconsumed`, () => {
      const { content } = make(axis);
      for (const type of ["text", "range", "file", "color"]) {
        const input = document.createElement("input"); input.type = type; content.append(input);
        drag(input, axis); expect(list!.getScrollPosition()).toBe(0);
      }
      for (const tag of ["a", "button", "summary"]) {
        const child = document.createElement(tag); content.append(child);
        expect(key(child, " ").defaultPrevented).toBe(false);
        expect(key(child, "Enter").defaultPrevented).toBe(false);
      }
      const link = document.createElement("a"); content.append(link);
      key(link, axis === "x" ? "ArrowRight" : "ArrowDown");
      expect(list!.getScrollPosition()).toBe(50);
    });
    it(`${axis}: stale release uses event clock and cancellation never flings`, () => {
      const { viewport } = make(axis);
      pointer(viewport, "pointerdown", 1, 200, 200, 0);
      pointer(viewport, "pointermove", 1, axis === "x" ? 150 : 200, axis === "y" ? 150 : 200, 16);
      pointer(window, "pointerup", 1, 150, 150, 200);
      frame(210); frame(226); expect(list!.getScrollPosition()).toBe(50);
      pointer(viewport, "pointerdown", 2, 200, 200, 230);
      pointer(viewport, "pointermove", 2, 100, 100, 246);
      pointer(window, "pointercancel", 2, 100, 100, 250);
      const stopped = list!.getScrollPosition(); frame(260); frame(276);
      expect(list!.getScrollPosition()).toBe(stopped);
    });
    it(`${axis}: second touch outside viewport cancels; all fingers up and stale-primary recover`, () => {
      const { viewport } = make(axis);
      pointer(viewport, "pointerdown", 1, 200, 200, 0);
      pointer(document.body, "pointerdown", 2, 10, 10, 5, false);
      pointer(viewport, "pointermove", 1, 150, 150, 16);
      expect(list!.getScrollPosition()).toBe(0);
      pointer(window, "pointerup", 2, 10, 10, 20, false);
      pointer(viewport, "pointermove", 1, 100, 100, 32);
      expect(list!.getScrollPosition()).toBe(0);
      pointer(window, "pointerup", 1, 100, 100, 40);
      drag(viewport, axis, 3, 50); expect(list!.getScrollPosition()).toBe(50);
      pointer(viewport, "pointerdown", 4, 200, 200, 80);
      pointer(viewport, "pointerdown", 5, 200, 200, 85, false);
      drag(viewport, axis, 6, 100); expect(list!.getScrollPosition()).toBe(100);
    });
    it(`${axis}: cross-axis wheel remains native; diagonal keeps both components`, () => {
      const { viewport } = make(axis);
      Object.defineProperty(viewport, axis === "x" ? "scrollHeight" : "scrollWidth", { configurable: true, value: 1000 });
      const cross = axis === "x" ? "scrollTop" : "scrollLeft";
      Object.defineProperty(viewport, cross, { configurable: true, value: 0, writable: true });
      expect(wheel(viewport, axis === "x" ? 0 : 50, axis === "x" ? 50 : 0).defaultPrevented).toBe(false);
      expect(list!.getScrollPosition()).toBe(0);
      expect(wheel(viewport, axis === "x" ? 50 : 10, axis === "x" ? 10 : 50).defaultPrevented).toBe(true);
      expect(viewport[cross]).toBe(10); expect(list!.getScrollPosition()).toBe(50);
    });
  }
  it("starting an editing-control gesture cancels inertia without owning its drag", () => {
    const { content } = make();
    drag(content, "y"); frame(100); frame(116);
    const position = list!.getScrollPosition();
    const range = document.createElement("input"); range.type = "range"; content.append(range);
    pointer(range, "pointerdown", 2, 200, 200, 120);
    pointer(range, "pointermove", 2, 100, 100, 136);
    pointer(window, "pointerup", 2, 100, 100, 140);
    frame(150); frame(166); expect(list!.getScrollPosition()).toBe(position);
  });
  it("catch suppresses only the catching pointer click, including after 500ms", () => {
    const { viewport, content } = make();
    let clicks = 0; content.addEventListener("click", () => clicks++);
    drag(content, "y"); frame(100); frame(116);
    pointer(content, "pointerdown", 2, 200, 200, 120);
    pointer(window, "pointerup", 2, 200, 200, 130);
    frame(800);
    const click = (id: number, detail = 1) => content.dispatchEvent(new PointerEvent("click", { bubbles: true, cancelable: true, pointerId: id, detail }));
    click(99); expect(clicks).toBe(1);
    click(-1, 0); expect(clicks).toBe(2);
    click(2); expect(clicks).toBe(2);
    pointer(viewport, "pointerdown", 3, 200, 200, 900); pointer(window, "pointerup", 3, 200, 200, 910);
    click(3); expect(clicks).toBe(3);
  });
  it("plugin-owned keyboard navigation runs before the synthetic fallback", () => {
    const plugin: VListPlugin<TestItem> = { name: "test-keyboard", setup(ctx) {
      ctx.registerKeydownHandler(e => {
        if (e.key === "ArrowDown") { ctx.scrollTo(200); e.preventDefault(); }
      });
    } };
    const { content } = make("y", [plugin]);
    key(content, "ArrowDown"); expect(list!.getScrollPosition()).toBe(200);
  });
  it("selection/a11y retain their existing activation and navigation policy", () => {
    for (const factory of [selection<TestItem>, a11y<TestItem>]) {
      const outcomes: unknown[] = [];
      for (const mode of ["native", "synthetic"] as const) {
        list = factoryFor(mode)({ container, items: createTestItems(1000), item: { height: 50, template: simpleTemplate } }, [factory()]);
        const content = container.querySelector<HTMLElement>(".vlist-content")!;
        const child = document.createElement("button"); content.append(child);
        let delivered = 0;
        list.element.addEventListener("keydown", () => delivered++);
        const space = key(child, " ").defaultPrevented;
        const enter = key(child, "Enter").defaultPrevented;
        key(content, "ArrowDown");
        outcomes.push({ space, enter, delivered, position: list.getScrollPosition() });
        list.destroy(); list = undefined;
      }
      expect(outcomes[1]).toEqual(outcomes[0]);
    }
  });
  it("pointermove and active frames neither schedule timers nor query capture repeatedly", () => {
    const { viewport } = make();
    let timers = 0, captures = 0;
    const original = globalThis.setTimeout;
    const hasCapture = viewport.hasPointerCapture;
    viewport.hasPointerCapture = id => { captures++; return hasCapture(id); };
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => { timers++; return original(...args); }) as typeof setTimeout;
    try {
      pointer(viewport, "pointerdown", 1, 200, 200, 0);
      pointer(viewport, "pointermove", 1, 200, 150, 16);
      pointer(viewport, "pointermove", 1, 200, 100, 32);
      expect(timers).toBe(0); expect(captures).toBe(0);
      pointer(window, "pointerup", 1, 200, 100, 40);
      timers = 0;
      frame(100); frame(116); frame(132);
      expect(timers).toBe(0);
    } finally { globalThis.setTimeout = original; }
  });
  it("unrelated page touches and their cancellation do not catch a fling", () => {
    const { viewport } = make(); drag(viewport, "y"); frame(100); frame(116);
    const before = list!.getScrollPosition();
    pointer(document.body, "pointerdown", 99, 0, 0, 120);
    pointer(window, "pointercancel", 99, 0, 0, 125);
    frame(132); expect(list!.getScrollPosition()).toBeGreaterThan(before);
  });
  it("table and groups render far logical positions without growing the stage", () => {
    for (const plugin of [
      table<TestItem>({ rowHeight: 50, columns: [{ key: "id", label: "ID", width: 500 }, { key: "name", label: "Name", width: 500 }] }),
      groups<TestItem>({ getGroupForIndex: index => String(Math.floor(index / 10)), headerHeight: 30, headerTemplate: name => name }),
    ]) {
      const { content } = make("y", [plugin]);
      list!.scrollToIndex(500, "start");
      expect(list!.getScrollPosition()).toBeGreaterThanOrEqual(25000);
      const beforeKey = list!.getScrollPosition();
      key(content, "ArrowDown");
      expect(list!.getScrollPosition()).toBe(beforeKey + 50);
      expect(content.style.height).toBe("100%");
      expect(content.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
      expect(content.querySelectorAll("[data-index]").length).toBeLessThan(40);
      list!.destroy(); list = undefined;
    }
  });
  it("snapshots and scrollbar navigate through logical state", () => {
    make("y", [snapshots<TestItem>(), scrollbar<TestItem>()]);
    list!.scrollToIndex(500, "start");
    const saved = (list!.getScrollSnapshot as () => ScrollSnapshot)();
    list!.scrollToIndex(0); (list!.restoreScroll as (snapshot: ScrollSnapshot) => void)(saved);
    expect(list!.getScrollPosition()).toBe(25000);
    expect(container.querySelector(".vlist-scrollbar__thumb")).not.toBeNull();
  });
});

it("handler completion callback, unchanged refresh, resize and detach contracts", () => {
  const viewport = document.createElement("div"), content = document.createElement("div");
  viewport.append(content); container.append(viewport);
  const state = createEngineState(20); state.containerSize = 500;
  let completed = 0, renders = 0;
  const handler = createSyntheticScrollHandler({ sizeCache: { getTotalSize: () => 50000, getSize: () => 50, indexAtOffset: position => Math.floor(position / 50) }, state, viewport, content, isX: false, wheelEnabled: true, idleTimeout: 150, mainAxisPadding: 0, onFrame: () => renders++, onIdle: () => {} });
  handler.refresh(10000); handler.attach();
  handler.smoothScrollTo(2000, 400, undefined, undefined, () => completed++);
  frame(100); handler.refresh(10000); frame(116); expect(state.scrollPosition).toBeGreaterThan(0);
  frame(250); expect(state.scrollPosition).toBe(2000); expect(completed).toBe(1);
  const before = renders; handler.setLogical(2500); expect(renders - before).toBe(1);
  handler.smoothScrollTo(3000, 400, undefined, undefined, () => completed++);
  state.containerSize = 9800; handler.refresh(10000); frame(300);
  expect(state.scrollPosition).toBe(200); expect(completed).toBe(1);
  handler.detach(); const stopped = renders; wheel(viewport, 0, -100); frame(400);
  expect(renders).toBe(stopped); expect(viewport.style.touchAction).toBe("");
});


describe("synthetic correction integration", () => {
  it("shifting active navigation preserves its one pending frame and completion", () => {
    let ctx!: PluginContext<TestItem>;
    make("y", [{ name: "capture-context", setup(value) { ctx = value; } }]);
    let completed = 0;
    ctx.smoothScrollTo(2000, 200, t => t, () => completed++);
    frame(0); frame(50);
    const pending = [...frames.keys()];
    ctx.shiftScroll(75);
    expect([...frames.keys()]).toEqual(pending);
    expect(ctx.getState().baseOffset).toBe(list!.getScrollPosition());
    for (const t of [100, 150, 200]) frame(t);
    expect(list!.getScrollPosition()).toBe(2075); expect(completed).toBe(1);
  });

  it("autosize measurement above the viewport keeps a synthetic fling moving", () => {
    const original = globalThis.ResizeObserver;
    let measure!: ResizeObserverCallback;
    const observed = new Set<Element>();
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) { measure = cb; }
      observe(el: Element) { observed.add(el); }
      unobserve(el: Element) { observed.delete(el); }
      disconnect() { observed.clear(); }
    } as unknown as typeof ResizeObserver;
    try {
      let ctx!: PluginContext<TestItem>;
      list = createVList({ container, items: createTestItems(1000),
        item: { estimatedHeight: 50, template: simpleTemplate } },
        [autosize(), { name: "capture-context", setup(value) { ctx = value; } }]);
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      viewport.setPointerCapture = () => {}; viewport.hasPointerCapture = () => false;
      list.scrollToIndex(10); drag(viewport, "y"); frame(40); frame(56);
      const before = list.getScrollPosition();
      const above = [...observed].find(el => el.isConnected && ctx.getRenderedElement(Number(el.getAttribute("data-index"))) === el && Number(el.getAttribute("data-index")) < ctx.sizeCache.indexAtOffset(before));
      expect(above).toBeDefined();
      measure([{ target: above!, borderBoxSize: [{ blockSize: 80, inlineSize: 300 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      expect(list.getScrollPosition()).toBeCloseTo(before + 30, 8);
      ctx.updateContentSize(ctx.sizeCache.getTotalSize());
      frame(72);
      expect(list.getScrollPosition()).toBeGreaterThan(before + 30);
      expect(ctx.getState().baseOffset).toBe(list.getScrollPosition());
    } finally { list?.destroy(); list = undefined; globalThis.ResizeObserver = original; }
  });

  it("native and bounded correction fallback matches their absolute scroll path", () => {
    for (const mode of ["native"] as const) {
      let ctx!: PluginContext<TestItem>;
      list = factoryFor(mode)({ container, items: createTestItems(1000), item: { height: 50, template: simpleTemplate } },
        [{ name: "capture-context", setup(value) { ctx = value; } }]);
      ctx.scrollTo(500);
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      viewport.dispatchEvent(new Event("scroll")); frame(0);
      const before = ctx.getState().scrollPosition;
      ctx.shiftScroll(75);
      const actualNative = viewport.scrollTop;
      const actualLogical = list.getScrollPosition();
      ctx.scrollTo(before + 75);
      expect(viewport.scrollTop).toBe(actualNative);
      expect(list.getScrollPosition()).toBe(actualLogical);
      list.destroy(); list = undefined;
    }
  });
});

it("transition animations end at rendered coordinates in native and synthetic entries", () => {
  const original = HTMLElement.prototype.animate;
  const animations: { el: HTMLElement; keyframes: Keyframe[] }[] = [];
  HTMLElement.prototype.animate = function(keyframes) {
    animations.push({ el: this, keyframes: keyframes as Keyframe[] });
    return { finished: new Promise(() => {}), playState: "running", cancel() {} } as unknown as Animation;
  };
  try {
    for (const mode of ["native", "synthetic"] as const) {
      list = factoryFor(mode)({ container, items: createTestItems(1000), item: { height: 50, template: simpleTemplate } }, [transition()]);
      list.scrollToIndex(500);
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      viewport.dispatchEvent(new Event("scroll")); frame(0);
      animations.length = 0;
      list.insertItem({ id: 10001, name: "Inserted", value: 0 }, 502);
      const moved = animations.filter(a => a.el.isConnected && a.el.dataset.index && !String(a.keyframes[a.keyframes.length - 1]?.transform).includes("scale"));
      expect(moved.length).toBeGreaterThan(0);
      for (const a of moved) expect(a.keyframes[a.keyframes.length - 1]?.transform).toBe(a.el.style.transform);
      list.scrollToIndex(1000, "end"); viewport.dispatchEvent(new Event("scroll")); frame(16);
      list.removeItem(999);
      expect(list.getScrollPosition()).toBe(49500);
      list.removeItems([997, 998]);
      expect(list.getScrollPosition()).toBe(49400);
      list.destroy(); list = undefined;
    }
  } finally { HTMLElement.prototype.animate = original; }
});


it("reverse transition insertion preserves end pinning for both scroll entries", () => {
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), playState: "finished", cancel() {} }) as unknown as Animation;
  try {
    for (const mode of ["native", "synthetic"] as const) {
      list = factoryFor(mode)({ container, reverse: true, items: createTestItems(1000), item: { height: 50, template: simpleTemplate } }, [transition()]);
      list.scrollToIndex(999, "end");
      container.querySelector(".vlist-viewport")!.dispatchEvent(new Event("scroll")); frame(0);
      expect(list.getScrollPosition()).toBe(49500);
      list.insertItem({ id: 10001, name: "Inserted", value: 0 }, 1000);
      expect(list.getScrollPosition()).toBe(49550);
      list.destroy(); list = undefined;
    }
  } finally { HTMLElement.prototype.animate = original; }
});

describe("synthetic unsupported-combination guards", () => {
  for (const name of ["carousel", "sortable"]) {
    it(`rejects ${name} before plugin setup or DOM creation`, () => {
      let setupCalled = false;
      const plugin: VListPlugin<TestItem> = { name, setup() { setupCalled = true; } };
      expect(() => make("y", [plugin])).toThrow(`${name} requires createVList from "vlist/native"`);
      expect(setupCalled).toBe(false); expect(container.children.length).toBe(0);
    });
    it(`leaves ${name} handling in the native entry to core`, () => {
      for (const mode of ["native"] as const) {
        let setupCalled = false;
        // Stub isolates the entry guard from each plugin's own mode policy.
        list = factoryFor(mode)({ container, items: createTestItems(10), item: { height: 50, template: simpleTemplate } },
          [{ name, setup() { setupCalled = true; } }]);
        expect(setupCalled).toBe(true); list.destroy(); list = undefined;
      }
    });
  }
  it("allows every supported plugin name through the entry", () => {
    const names = ["table", "groups", "snapshots", "scrollbar", "autosize", "transition", "selection", "a11y"];
    const called: string[] = [];
    make("y", names.map(name => ({ name, setup() { called.push(name); } })));
    expect(called.sort()).toEqual(names.sort());
    // Real-plugin integration coverage is above; combinations still respect
    // plugin conflicts (for example, table and transition cannot be combined).
  });
});

describe("synthetic horizontal RTL creation guard", () => {
  it("rejects computed RTL for element and selector containers before creating DOM", () => {
    container.style.direction = "rtl";
    container.id = "rtl-synthetic-container";
    for (const target of [container, "#rtl-synthetic-container"]) {
      expect(() => createVList({ container: target, orientation: "horizontal", items: createTestItems(10),
        item: { width: 50, template: simpleTemplate } }))
        .toThrow('RTL horizontal lists require createVList from "vlist/native"');
      expect(container.children.length).toBe(0);
    }
  });
  it("allows vertical RTL and horizontal LTR synthetic lists", () => {
    container.style.direction = "rtl";
    make("y"); list!.scrollToIndex(10); expect(list!.getScrollPosition()).toBe(500);
    list!.destroy(); list = undefined;
    container.style.direction = "ltr";
    make("x"); list!.scrollToIndex(10); expect(list!.getScrollPosition()).toBe(500);
  });
  it("leaves horizontal RTL handling in the native entry unchanged", () => {
    container.style.direction = "rtl";
    for (const mode of ["native"] as const) {
      list = factoryFor(mode)({ container, orientation: "horizontal", items: createTestItems(100),
        item: { width: 50, template: simpleTemplate } });
      expect(list.element).toBeDefined(); list.destroy(); list = undefined;
    }
  });
});


it("reads horizontal synthetic direction once at creation, never during input", () => {
  const original = globalThis.getComputedStyle;
  let reads = 0;
  globalThis.getComputedStyle = ((element: Element, pseudo?: string | null) => {
    if (element === container) reads++;
    return original(element, pseudo);
  }) as typeof getComputedStyle;
  try {
    container.style.direction = "ltr";
    const { viewport } = make("x");
    expect(reads).toBe(1);
    drag(viewport, "x"); frame(40); frame(56); key(viewport, "ArrowRight");
    expect(reads).toBe(1);
  } finally { globalThis.getComputedStyle = original; }
});
