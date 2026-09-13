import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/synthetic";
import type { VList, VListPlugin } from "../../src/core/types";
import { createSyntheticScrollHandler } from "../../src/synthetic/handler";
import { createEngineState } from "../../src/core/state";
import { a11y } from "../../src/plugins/a11y";
import { selection } from "../../src/plugins/selection";
import type { ScrollSnapshot } from "../../src/types";
import { groups } from "../../src/plugins/groups";
import { table } from "../../src/plugins/table";
import { snapshots } from "../../src/plugins/snapshots";
import { scrollbar } from "../../src/plugins/scrollbar";

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
    items: createTestItems(1000), item: { height: 50, width: 50, template: simpleTemplate },
    scroll: { mode: "synthetic" } }, plugins);
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
  it("the separate entry retains native and bounded mode behavior", () => {
    for (const mode of ["native", "bounded"] as const) {
      list = createVList({ container, items: createTestItems(1000), item: { height: 50, template: simpleTemplate }, scroll: { mode } });
      const content = container.querySelector<HTMLElement>(".vlist-content")!;
      expect(content.style.height).toBe(mode === "native" ? "50000px" : "1000px");
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
      for (const type of ["text", "range"]) {
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
  it("selection/a11y consume navigation once and preserve descendant activation", () => {
    for (const plugin of [selection<TestItem>(), a11y<TestItem>()]) {
      const { content } = make("y", [plugin]);
      const child = document.createElement("button"); content.append(child);
      expect(key(child, " ").defaultPrevented).toBe(false);
      expect(key(child, "Enter").defaultPrevented).toBe(false);
      key(content, "ArrowDown");
      expect(list!.getScrollPosition()).toBeLessThanOrEqual(50);
      list!.destroy(); list = undefined;
    }
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
  const handler = createSyntheticScrollHandler({ state, viewport, content, isX: false, wheelEnabled: true, idleTimeout: 150, mainAxisPadding: 0, onFrame: () => renders++, onIdle: () => {} });
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
