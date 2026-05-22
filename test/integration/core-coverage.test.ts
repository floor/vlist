import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import {
  phase1Calculate,
  phase2Commit,
} from "../../src/core/pipeline";
import {
  compileHooks,
  runCommitHooks,
  runIdleHooks,
  runAfterScrollHooks,
  runResizeHooks,
} from "../../src/core/hooks";
import { createEngineState } from "../../src/core/state";
import { createSizeCache } from "../../src/core/sizes";
import { createPool } from "../../src/core/pool";
import { createScrollHandler } from "../../src/core/scroll";
import { useFakeTimers } from "../helpers/dom";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

// ─── createVList edge cases ──────────────────────────────────────────────────

describe("createVList validation", () => {
  let container: HTMLElement;

  beforeEach(() => { container = createContainer({ width: 300, height: 500 }); });
  afterEach(() => { container.remove(); });

  it("should throw on duplicate plugin names", () => {
    const dup: VListPlugin<TestItem> = { name: "test-dup", priority: 50 };
    expect(() =>
      createVList(
        { container, items: [], item: { height: 40, template: simpleTemplate } },
        [dup, dup],
      ),
    ).toThrow("Duplicate plugin");
  });

  it("should throw on conflicting plugins", () => {
    const a: VListPlugin<TestItem> = { name: "alpha", priority: 50 };
    const b: VListPlugin<TestItem> = { name: "beta", priority: 50, conflicts: ["alpha"] };
    expect(() =>
      createVList(
        { container, items: [], item: { height: 40, template: simpleTemplate } },
        [a, b],
      ),
    ).toThrow('conflicts with "alpha"');
  });

  it("should support string container selector", () => {
    container.id = "test-container-selector";
    const list = createVList(
      { container: "#test-container-selector", items: createTestItems(5), item: { height: 40, template: simpleTemplate } },
      [],
    );
    expect(list.total).toBe(5);
    list.destroy();
  });

  it("should throw on invalid string selector", () => {
    expect(() =>
      createVList(
        { container: "#nonexistent-container", items: [], item: { height: 40, template: simpleTemplate } },
        [],
      ),
    ).toThrow("Container not found");
  });
});

// ─── Data mutation paths ─────────────────────────────────────────────────────

describe("createVList data mutations", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null;

  beforeEach(() => { container = createContainer({ width: 300, height: 500 }); list = null; });
  afterEach(() => { list?.destroy(); container.remove(); });

  it("should prepend items and shift existing indices", () => {
    list = createVList(
      { container, items: createTestItems(10), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.prependItems(createTestItems(3, 100));
    expect(list.total).toBe(13);
    expect(list.items[0]!.id).toBe(100);
    expect(list.items[3]!.id).toBe(1);
  });

  it("should insert item at end when index is omitted", () => {
    list = createVList(
      { container, items: createTestItems(5), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.insertItem({ id: 999, name: "Last" } as TestItem);
    expect(list.total).toBe(6);
    expect(list.items[5]!.id).toBe(999);
  });

  it("should handle removeItem for nonexistent id", () => {
    list = createVList(
      { container, items: createTestItems(5), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.removeItem(999);
    expect(list.total).toBe(5);
  });

  it("should handle removeItems returning correct count", () => {
    list = createVList(
      { container, items: createTestItems(10), item: { height: 40, template: simpleTemplate } },
      [],
    );
    const removed = list.removeItems([1, 3, 999]);
    expect(removed).toBe(2);
    expect(list.total).toBe(8);
  });

  it("should handle updateItem for nonexistent id", () => {
    list = createVList(
      { container, items: createTestItems(5), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.updateItem(999, { name: "Nope" });
    expect(list.total).toBe(5);
  });
});

// ─── Scroll paths ────────────────────────────────────────────────────────────

describe("createVList scroll", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null;

  beforeEach(() => { container = createContainer({ width: 300, height: 500 }); list = null; });
  afterEach(() => { list?.destroy(); container.remove(); });

  it("should scroll to index with center alignment", () => {
    list = createVList(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.scrollToIndex(50, "center");
    const vp = list.element.querySelector(".vlist-viewport") as HTMLElement;
    const expected = 50 * 40 - (500 - 40) / 2;
    expect(vp.scrollTop).toBe(expected);
  });

  it("should scroll to index with end alignment", () => {
    list = createVList(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.scrollToIndex(50, "end");
    const vp = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(vp.scrollTop).toBe(50 * 40 + 40 - 500);
  });

  it("should noop scrollToIndex on empty list", () => {
    list = createVList(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [],
    );
    expect(() => list!.scrollToIndex(10)).not.toThrow();
  });

  it("should emit scroll:idle after scrolling stops", async () => {
    list = createVList(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [],
    );
    const handler = mock(() => {});
    list.on("scroll:idle", handler);

    const vp = list.element.querySelector(".vlist-viewport") as HTMLElement;
    Object.defineProperty(vp, "scrollTop", { value: 200, writable: true, configurable: true });
    vp.dispatchEvent(new Event("scroll"));

    await new Promise((r) => setTimeout(r, 200));
    expect(handler).toHaveBeenCalled();
  });
});

// ─── Horizontal mode ─────────────────────────────────────────────────────────

describe("createVList horizontal", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null;

  beforeEach(() => { container = createContainer({ width: 300, height: 500 }); list = null; });
  afterEach(() => { list?.destroy(); container.remove(); });

  it("should set content width instead of height", () => {
    list = createVList(
      { container, items: createTestItems(50), item: { width: 100, template: simpleTemplate }, orientation: "horizontal" },
      [],
    );
    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(parseInt(content.style.width, 10)).toBe(50 * 100);
  });

  it("should use scrollLeft for horizontal scrollToIndex", () => {
    list = createVList(
      { container, items: createTestItems(50), item: { width: 100, template: simpleTemplate }, orientation: "horizontal" },
      [],
    );
    list.scrollToIndex(20, "start");
    const vp = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(vp.scrollLeft).toBe(20 * 100);
  });
});

// ─── Hook runners ────────────────────────────────────────────────────────────

describe("hook runners", () => {
  it("should run commit hooks", () => {
    const fn = mock(() => {});
    const state = createEngineState(100);
    runCommitHooks([fn], state);
    expect(fn).toHaveBeenCalledWith(state);
  });

  it("should run idle hooks", () => {
    const fn = mock(() => {});
    runIdleHooks([fn]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should run afterScroll hooks with position and direction", () => {
    const fn = mock(() => {});
    runAfterScrollHooks([fn], 500, 1);
    expect(fn).toHaveBeenCalledWith(500, 1);
  });

  it("should run resize hooks with width and height", () => {
    const fn = mock(() => {});
    runResizeHooks([fn], 800, 600);
    expect(fn).toHaveBeenCalledWith(800, 600);
  });

  it("should compile hooks from plugins with all hook types", () => {
    const calc = mock(() => {});
    const commit = mock(() => {});
    const afterScroll = mock(() => {});
    const idle = mock(() => {});
    const resize = mock(() => {});

    const plugins: VListPlugin<TestItem>[] = [
      {
        name: "test",
        priority: 50,
        hooks: { onCalculate: calc, onCommit: commit, onAfterScroll: afterScroll, onIdle: idle, onResize: resize },
      },
    ];

    const compiled = compileHooks(plugins);
    expect(compiled.calculate).toHaveLength(1);
    expect(compiled.commit).toHaveLength(1);
    expect(compiled.afterScroll).toHaveLength(1);
    expect(compiled.idle).toHaveLength(1);
    expect(compiled.resize).toHaveLength(1);
  });

  it("should skip plugins without hooks", () => {
    const plugins: VListPlugin<TestItem>[] = [
      { name: "no-hooks", priority: 50 },
    ];
    const compiled = compileHooks(plugins);
    expect(compiled.calculate).toHaveLength(0);
    expect(compiled.idle).toHaveLength(0);
  });
});

// ─── Pipeline edge cases ─────────────────────────────────────────────────────

describe("pipeline", () => {
  it("should handle template returning HTMLElement", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 5;
    const sizeCache = createSizeCache(40, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);

    const elementTemplate = (_item: TestItem, _index: number) => {
      const el = document.createElement("span");
      el.textContent = _item.name;
      return el;
    };

    const items: TestItem[] = createTestItems(5);
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    expect(rendered.size).toBeGreaterThan(0);
    const first = rendered.get(0)!;
    expect(first.querySelector("span")).not.toBeNull();
  });

  it("should update existing element when item identity changes with HTMLElement template", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 5;
    const sizeCache = createSizeCache(40, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);

    let items: TestItem[] = createTestItems(5);
    const elementTemplate = (item: TestItem) => {
      const el = document.createElement("span");
      el.textContent = item.name;
      return el;
    };

    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    items = items.map((item, i) => ({ ...item, id: item.id + 100, name: `New ${i}` }));
    state.renderPending = true;
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    const el = rendered.get(0)!;
    expect(el.querySelector("span")!.textContent).toBe("New 0");
  });

  it("should re-render when item reference changes but id stays the same", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 5;
    const sizeCache = createSizeCache(40, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);

    let items: TestItem[] = createTestItems(5);
    const elementTemplate = (item: TestItem) => {
      const el = document.createElement("span");
      el.textContent = item.name;
      return el;
    };

    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    const elBefore = rendered.get(0)!;
    expect(elBefore.querySelector("span")!.textContent).toBe("Item 1");

    // Replace item 0 with a new object that has the SAME id but different content
    items = items.slice();
    items[0] = { ...items[0]!, name: "Updated" };

    state.renderPending = true;
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    const elAfter = rendered.get(0)!;
    expect(elAfter.querySelector("span")!.textContent).toBe("Updated");
  });

  it("should NOT re-render when item reference is the same object", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 5;
    const sizeCache = createSizeCache(40, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);

    const items: TestItem[] = createTestItems(5);
    let templateCallCount = 0;
    const elementTemplate = (item: TestItem) => {
      templateCallCount++;
      const el = document.createElement("span");
      el.textContent = item.name;
      return el;
    };

    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);
    const initialCalls = templateCallCount;

    // Re-render with the exact same items array — same references
    state.renderPending = true;
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, elementTemplate, () => items, rendered, false, hooks);

    // Template should NOT have been called again — same references
    expect(templateCallCount).toBe(initialCalls);
  });

  it("should toggle focused class on existing elements", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 5;
    const sizeCache = createSizeCache(40, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const items = createTestItems(5);

    let focusedIndex = -1;
    const itemStateFn = (index: number, s: { selected: boolean; focused: boolean }) => {
      s.selected = false;
      s.focused = index === focusedIndex;
    };

    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, false, hooks, null, itemStateFn);

    focusedIndex = 0;
    state.renderPending = true;
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, false, hooks, null, itemStateFn);

    expect(rendered.get(0)!.classList.contains("vlist-item--focused")).toBe(true);

    focusedIndex = 1;
    state.renderPending = true;
    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, false, hooks, null, itemStateFn);

    expect(rendered.get(0)!.classList.contains("vlist-item--focused")).toBe(false);
    expect(rendered.get(1)!.classList.contains("vlist-item--focused")).toBe(true);
  });

  it("should apply horizontal sizing on existing elements when size changes", () => {
    const state = createEngineState(100);
    state.containerSize = 300;
    state.totalItems = 5;
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const items = createTestItems(5);

    let itemWidth = 100;
    const sizeCache = createSizeCache(() => itemWidth, 5);

    phase1Calculate(state, sizeCache, 2, hooks);
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, true, hooks);

    const el = rendered.get(0)!;
    expect(el.style.width).toBe("100px");

    itemWidth = 150;
    const newCache = createSizeCache(() => itemWidth, 5);
    state.renderPending = true;
    phase1Calculate(state, newCache, 2, hooks);
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, true, hooks);

    expect(el.style.width).toBe("150px");
  });

  it("should early-exit phase1 when range is unchanged", () => {
    const state = createEngineState(100);
    state.containerSize = 500;
    state.totalItems = 10;
    const sizeCache = createSizeCache(40, 10);
    const hooks = compileHooks([]);

    const changed1 = phase1Calculate(state, sizeCache, 2, hooks);
    expect(changed1).toBe(true);

    const changed2 = phase1Calculate(state, sizeCache, 2, hooks);
    expect(changed2).toBe(false);
  });

  it("should clear state when container size is 0", () => {
    const state = createEngineState(100);
    state.containerSize = 0;
    state.totalItems = 10;
    const sizeCache = createSizeCache(40, 10);
    const hooks = compileHooks([]);

    const changed = phase1Calculate(state, sizeCache, 2, hooks);
    expect(changed).toBe(true);
    expect(state.visibleCount).toBe(0);
  });
});

// ─── Scroll handler: horizontal wheel ────────────────────────────────────────

describe("scroll handler horizontal wheel", () => {
  it("should handle vertical wheel in horizontal mode", () => {
    const state = createEngineState(100);
    state.scrollPosition = 0;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollLeft", { value: 0, writable: true, configurable: true });
    Object.defineProperty(viewport, "scrollWidth", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });

    const onFrame = mock(() => {});
    const onIdle = mock(() => {});

    const handler = createScrollHandler({
      state,
      viewport,
      horizontal: true,
      wheelEnabled: true,
      idleTimeout: 150,
      onFrame,
      onIdle,
    });
    handler.attach();

    const event = new WheelEvent("wheel", { deltaY: 100, deltaX: 0, bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);

    expect(onFrame).toHaveBeenCalled();
    handler.detach();
  });

  it("should passthrough deltaX-dominant wheel in horizontal mode", () => {
    const state = createEngineState(100);
    state.scrollPosition = 0;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollLeft", { value: 0, writable: true, configurable: true });
    Object.defineProperty(viewport, "scrollWidth", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });

    const onFrame = mock(() => {});
    const handler = createScrollHandler({
      state, viewport, horizontal: true, wheelEnabled: true, idleTimeout: 150,
      onFrame, onIdle: () => {},
    });
    handler.attach();

    const event = new WheelEvent("wheel", { deltaX: 100, deltaY: 10, bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("should handle cross-axis overflow deltaX passthrough in vertical mode", () => {
    const state = createEngineState(100);
    state.scrollPosition = 0;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollTop", { value: 0, writable: true, configurable: true });
    Object.defineProperty(viewport, "scrollLeft", { value: 0, writable: true, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(viewport, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });

    const onFrame = mock(() => {});
    const handler = createScrollHandler({
      state, viewport, horizontal: false, wheelEnabled: true, idleTimeout: 150,
      onFrame, onIdle: () => {},
    });
    handler.attach();

    const event = new WheelEvent("wheel", { deltaX: 50, deltaY: 5, bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });
});
