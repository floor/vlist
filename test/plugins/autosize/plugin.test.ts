/**
 * vlist v2 — Autosize Plugin Tests
 * Tests for: factory shape, validation, setup (size cache replacement,
 * ResizeObserver wiring, onCommit observation), idle flush, destroy cleanup.
 *
 * Adapted from v1 withAutoSize feature tests to v2 PluginContext API.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";

import { autosize } from "../../../src/plugins/autosize/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { setupDOM, teardownDOM, createMockResizeObserver } from "../../helpers/dom";

// =============================================================================
// JSDOM Setup
// =============================================================================

beforeAll(() => {
  // Install a ResizeObserver that fires synchronously with configurable sizes.
  // The default setupDOM() mock uses contentRect but the autosize plugin reads
  // borderBoxSize[0], so we override it after setupDOM.
  setupDOM({ immediateResize: false });

  // Override ResizeObserver to fire synchronously with borderBoxSize data
  // (matching the structure the autosize plugin reads)
  (global as any).ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
    }
    observe(target: Element): void {
      const el = target as HTMLElement;
      const hasIndex = el.dataset?.index != null;
      // Items get size 80; container gets size 300×500
      const blockSize = hasIndex ? 80 : 500;
      const inlineSize = hasIndex ? 80 : 300;
      this.callback(
        [
          {
            target,
            contentRect: {
              width: inlineSize,
              height: blockSize,
              top: 0,
              left: 0,
              bottom: blockSize,
              right: inlineSize,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            } as DOMRectReadOnly,
            borderBoxSize: [
              { blockSize, inlineSize } as ResizeObserverSize,
            ],
            contentBoxSize: [
              { blockSize, inlineSize } as ResizeObserverSize,
            ],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterAll(() => {
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 100, name: `Item ${i}` }));

// =============================================================================
// Factory Tests
// =============================================================================

describe("autosize factory", () => {
  it("should return a VListPlugin with correct name and priority", () => {
    const plugin = autosize();
    expect(plugin.name).toBe("autosize");
    expect(plugin.priority).toBe(5);
    expect(typeof plugin.setup).toBe("function");
    expect(typeof plugin.destroy).toBe("function");
  });

  it("should return independent instances", () => {
    const a = autosize();
    const b = autosize();
    expect(a).not.toBe(b);
  });

  it("should accept gap config", () => {
    const plugin = autosize({ gap: 8 });
    expect(plugin.name).toBe("autosize");
  });
});

// =============================================================================
// Setup Tests
// =============================================================================

describe("autosize setup", () => {
  let mockCtx: ReturnType<typeof createPluginMockContext<TestItem>>;

  beforeEach(() => {
    mockCtx = createPluginMockContext(createTestItems(20), {
      itemSize: 50,
      containerWidth: 300,
      containerHeight: 500,
    });
  });

  afterEach(() => {
    mockCtx.cleanup();
  });

  it("should call setSizeConfig during setup", () => {
    let sizeFnRegistered = false;
    mockCtx.ctx.setSizeConfig = () => { sizeFnRegistered = true; };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);
    plugin.destroy();

    expect(sizeFnRegistered).toBe(true);
  });

  it("should register destroy handler during setup", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    expect(mockCtx.destroyHandlers.length).toBeGreaterThan(0);

    plugin.destroy();
  });

  it("should register isMeasured method", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const isMeasured = mockCtx.methods.get("isMeasured") as ((index: number) => boolean) | undefined;
    expect(typeof isMeasured).toBe("function");
    expect(isMeasured!(0)).toBe(false);

    plugin.destroy();
  });

  it("should register setMeasuredSize method", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const setMeasuredSize = mockCtx.methods.get("setMeasuredSize") as ((index: number, size: number) => void) | undefined;
    expect(typeof setMeasuredSize).toBe("function");

    plugin.destroy();
  });

  it("should register getMeasuredCount method", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const getMeasuredCount = mockCtx.methods.get("getMeasuredCount") as (() => number) | undefined;
    expect(typeof getMeasuredCount).toBe("function");
    expect(getMeasuredCount!()).toBe(0);

    plugin.destroy();
  });

  it("should have onCommit hook", () => {
    const plugin = autosize();
    expect(plugin.hooks).toBeDefined();
    expect(typeof plugin.hooks?.onCommit).toBe("function");
  });

  it("should have onIdle hook", () => {
    const plugin = autosize();
    expect(typeof plugin.hooks?.onIdle).toBe("function");
  });
});

// =============================================================================
// Measured Size Tracking
// =============================================================================

describe("autosize measured size tracking", () => {
  let mockCtx: ReturnType<typeof createPluginMockContext<TestItem>>;

  beforeEach(() => {
    mockCtx = createPluginMockContext(createTestItems(10), {
      itemSize: 50,
    });
  });

  afterEach(() => {
    mockCtx.cleanup();
  });

  it("isMeasured returns false before measurement, true after setMeasuredSize", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const isMeasured = mockCtx.methods.get("isMeasured") as (index: number) => boolean;
    const setMeasuredSize = mockCtx.methods.get("setMeasuredSize") as (index: number, size: number) => void;
    const getMeasuredCount = mockCtx.methods.get("getMeasuredCount") as () => number;

    expect(isMeasured(0)).toBe(false);
    expect(getMeasuredCount()).toBe(0);

    setMeasuredSize(0, 80);

    expect(isMeasured(0)).toBe(true);
    expect(getMeasuredCount()).toBe(1);

    plugin.destroy();
  });

  it("getMeasuredCount increments for each measured item", () => {
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const setMeasuredSize = mockCtx.methods.get("setMeasuredSize") as (index: number, size: number) => void;
    const getMeasuredCount = mockCtx.methods.get("getMeasuredCount") as () => number;

    setMeasuredSize(0, 80);
    setMeasuredSize(1, 90);
    setMeasuredSize(2, 70);

    expect(getMeasuredCount()).toBe(3);

    plugin.destroy();
  });
});

// =============================================================================
// onCommit Hook Tests
// =============================================================================

describe("autosize onCommit hook", () => {
  let mockCtx: ReturnType<typeof createPluginMockContext<TestItem>>;

  beforeEach(() => {
    mockCtx = createPluginMockContext(createTestItems(10), {
      itemSize: 50,
    });
  });

  afterEach(() => {
    mockCtx.cleanup();
  });

  it("onCommit observes unmeasured rendered elements", () => {
    const observedElements: Element[] = [];
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(el: Element): void { observedElements.push(el); }
      unobserve(): void {}
      disconnect(): void {}
    };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // Simulate a rendered element for index 0
    const el = document.createElement("div");
    el.setAttribute("data-index", "0");
    mockCtx.dom.content.appendChild(el);
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 0 ? el : null);

    const state = mockCtx.engineState;
    state.visibleCount = 1;
    state.visibleIndices[0] = 0;

    plugin.hooks!.onCommit!(state);

    expect(observedElements).toContain(el);

    plugin.destroy();
  });

  it("onCommit skips already-measured items", () => {
    const observedElements: Element[] = [];
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(el: Element): void { observedElements.push(el); }
      unobserve(): void {}
      disconnect(): void {}
    };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // Pre-measure index 0
    const setMeasuredSize = mockCtx.methods.get("setMeasuredSize") as (index: number, size: number) => void;
    setMeasuredSize(0, 80);

    const el = document.createElement("div");
    el.setAttribute("data-index", "0");
    mockCtx.dom.content.appendChild(el);
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 0 ? el : null);

    const state = mockCtx.engineState;
    state.visibleCount = 1;
    state.visibleIndices[0] = 0;

    plugin.hooks!.onCommit!(state);

    // Already measured — should not observe again
    expect(observedElements).not.toContain(el);

    plugin.destroy();
  });

  it("onCommit clears explicit size so ResizeObserver can measure natural size", () => {
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    const el = document.createElement("div");
    el.setAttribute("data-index", "0");
    el.style.height = "50px"; // explicit size set by commit phase
    mockCtx.dom.content.appendChild(el);
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 0 ? el : null);

    const state = mockCtx.engineState;
    state.visibleCount = 1;
    state.visibleIndices[0] = 0;

    plugin.hooks!.onCommit!(state);

    // height should be cleared so ResizeObserver can measure natural size
    expect(el.style.height).toBe("");

    plugin.destroy();
  });
});

// =============================================================================
// onIdle Hook Tests
// =============================================================================

describe("autosize onIdle hook", () => {
  it("onIdle is safe to call when no pending content update", () => {
    const mockCtx = createPluginMockContext(createTestItems(5), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // onIdle with no pending update should not throw
    expect(() => plugin.hooks!.onIdle!()).not.toThrow();

    plugin.destroy();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Destroy Tests
// =============================================================================

describe("autosize destroy", () => {
  it("should clean up on destroy without errors", () => {
    const mockCtx = createPluginMockContext(createTestItems(10), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    expect(() => plugin.destroy()).not.toThrow();

    mockCtx.cleanup();
  });

  it("should be safe to call destroy twice", () => {
    const mockCtx = createPluginMockContext(createTestItems(10), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    plugin.destroy();
    expect(() => plugin.destroy()).not.toThrow();

    mockCtx.cleanup();
  });

  it("should handle destroy before setup (no observer)", () => {
    const plugin = autosize();
    expect(() => plugin.destroy()).not.toThrow();
  });

  it("destroyHandlers registered during setup disconnect the observer", () => {
    let disconnectCalled = false;
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnectCalled = true; }
    };

    const mockCtx = createPluginMockContext(createTestItems(5), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // Run the registered destroy handlers (simulates what createVList does on destroy)
    for (const handler of mockCtx.destroyHandlers) handler();

    expect(disconnectCalled).toBe(true);

    mockCtx.cleanup();
  });

  it("plugin.destroy() disconnects observer", () => {
    let disconnectCalled = false;
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnectCalled = true; }
    };

    const mockCtx = createPluginMockContext(createTestItems(5), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    plugin.destroy();

    expect(disconnectCalled).toBe(true);

    mockCtx.cleanup();
  });

  it("plugin.destroy() is safe to call after destroyHandlers run", () => {
    let disconnectCallCount = 0;
    (global as any).ResizeObserver = class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnectCallCount++; }
    };

    const mockCtx = createPluginMockContext(createTestItems(5), { itemSize: 50 });
    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // Simulate normal lifecycle: handler runs first, then plugin.destroy() is called
    for (const handler of mockCtx.destroyHandlers) handler();
    expect(() => plugin.destroy()).not.toThrow();

    mockCtx.cleanup();
  });
});

// =============================================================================
// Gap Config Tests
// =============================================================================

describe("autosize gap config", () => {
  it("should use gap=0 by default (sizeFn returns estimated size)", () => {
    let capturedSizeFn: ((index: number) => number) | null = null;
    const mockCtx = createPluginMockContext(createTestItems(5), { itemSize: 60 });
    mockCtx.ctx.setSizeConfig = (fn: (index: number) => number) => {
      capturedSizeFn = fn;
    };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    // Before any measurements, sizeFn returns the estimated size (60)
    expect(capturedSizeFn).not.toBeNull();
    expect(capturedSizeFn!(0)).toBe(60);

    plugin.destroy();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Anchor Preservation & Scroll Compensation
// =============================================================================

describe("autosize anchor preservation", () => {
  /**
   * Creates a ResizeObserver mock that captures the callback so tests can
   * trigger measurements manually with controlled sizes.
   */
  function createControllableRO() {
    let roCallback: ResizeObserverCallback | null = null;
    const observed = new Map<Element, number>();

    class ControllableRO {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe(el: Element): void {
        const idx = parseInt((el as HTMLElement).getAttribute("data-index") ?? "0", 10);
        observed.set(el, idx);
      }
      unobserve(el: Element): void { observed.delete(el); }
      disconnect(): void { observed.clear(); }
    }

    function triggerMeasurement(el: HTMLElement, size: number): void {
      roCallback!(
        [{
          target: el,
          contentRect: { width: size, height: size, top: 0, left: 0, bottom: size, right: size, x: 0, y: 0, toJSON: () => ({}) } as DOMRectReadOnly,
          borderBoxSize: [{ blockSize: size, inlineSize: size } as ResizeObserverSize],
          contentBoxSize: [{ blockSize: size, inlineSize: size } as ResizeObserverSize],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry],
        null as unknown as ResizeObserver,
      );
    }

    (global as any).ResizeObserver = ControllableRO;
    return { triggerMeasurement, observed };
  }

  function setupAnchorTest() {
    const { triggerMeasurement, observed } = createControllableRO();

    const mockCtx = createPluginMockContext(createTestItems(20), {
      itemSize: 50,
      containerHeight: 300,
    });

    // Wire setSizeConfig so the plugin's sizeFn is actually used
    let pluginSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: (index: number) => number) => {
      pluginSizeFn = fn;
    };

    // rebuildSizeCache is called after measurements — track calls
    let rebuildCount = 0;
    mockCtx.ctx.rebuildSizeCache = () => { rebuildCount++; };

    // forceRender tracking
    let forceRenderCount = 0;
    mockCtx.ctx.forceRender = () => { forceRenderCount++; };

    const plugin = autosize();
    plugin.setup(mockCtx.ctx);

    return {
      mockCtx,
      plugin,
      triggerMeasurement,
      observed,
      get rebuildCount() { return rebuildCount; },
      get forceRenderCount() { return forceRenderCount; },
      getSizeFn: () => pluginSizeFn,
    };
  }

  function addElement(content: HTMLElement, index: number): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-index", String(index));
    content.appendChild(el);
    return el;
  }

  it("compensates scroll when item above viewport is measured larger", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;

    // Step 1: item 2 is visible, observe it
    state.startIndex = 0;
    state.scrollPosition = 0;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = i;

    const el = addElement(mockCtx.dom.content, 2);
    plugin.hooks!.onCommit!(state);

    // Step 2: scroll down so item 2 is above viewport
    state.startIndex = 5;
    state.scrollPosition = 250;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 5 + i;

    // Measure at 80px instead of estimated 50px → delta = +30
    triggerMeasurement(el, 80);

    // scrollTo should have been called with 250 + 30 = 280
    expect(mockCtx.scrollCalls).toContain(280);

    plugin.destroy();
    mockCtx.cleanup();
  });

  it("does not compensate scroll when item inside viewport is measured", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;

    // Item 7 is inside viewport
    state.startIndex = 5;
    state.scrollPosition = 250;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 5 + i;

    const el = addElement(mockCtx.dom.content, 7);
    plugin.hooks!.onCommit!(state);

    const scrollCallsBefore = mockCtx.scrollCalls.length;
    triggerMeasurement(el, 80);

    // No scroll compensation — item is at or after startIndex
    expect(mockCtx.scrollCalls.length).toBe(scrollCallsBefore);

    plugin.destroy();
    mockCtx.cleanup();
  });

  it("does not compensate scroll when item below viewport is measured", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;

    // Step 1: item 15 is visible, observe it
    state.startIndex = 13;
    state.scrollPosition = 650;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 13 + i;

    const el = addElement(mockCtx.dom.content, 15);
    plugin.hooks!.onCommit!(state);

    // Step 2: scroll back up so item 15 is below viewport
    state.startIndex = 5;
    state.scrollPosition = 250;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 5 + i;

    const scrollCallsBefore = mockCtx.scrollCalls.length;
    triggerMeasurement(el, 80);

    // No scroll compensation — item is below startIndex (15 >= 5 is true,
    // but the compensation check is index < firstVisible)
    // Actually item 15 is AFTER startIndex 5, so no compensation
    expect(mockCtx.scrollCalls.length).toBe(scrollCallsBefore);

    plugin.destroy();
    mockCtx.cleanup();
  });

  it("snaps to bottom when at bottom and item above resizes", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;
    const viewport = mockCtx.dom.viewport;

    // Make scrollTo update engineState so snapToBottom works correctly
    mockCtx.ctx.scrollTo = (pos: number) => {
      mockCtx.scrollCalls.push(pos);
      state.scrollPosition = pos;
    };

    // Step 1: item 3 was visible, observe it
    state.startIndex = 0;
    state.scrollPosition = 0;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = i;

    const el = addElement(mockCtx.dom.content, 3);
    plugin.hooks!.onCommit!(state);

    // Step 2: scroll to bottom (maxScroll = 1000 - 300 = 700, within BOTTOM_THRESHOLD)
    state.startIndex = 14;
    state.scrollPosition = 700;
    state.totalItems = 20;
    state.prevRangeEnd = 19;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 14 + i;

    // scrollHeight must be dynamic: updateContentSize sets content.style.height,
    // and snapToBottom re-reads scrollHeight after reflow. Simulate by tracking
    // content height and returning it via a getter.
    let fakeScrollHeight = 1000;
    Object.defineProperty(viewport, "scrollHeight", {
      get: () => fakeScrollHeight,
      configurable: true,
    });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });

    // rebuildSizeCache + updateContentSize simulate the total growing by 30
    mockCtx.ctx.rebuildSizeCache = () => {};
    mockCtx.ctx.updateContentSize = () => { fakeScrollHeight = 1030; };

    triggerMeasurement(el, 80);

    // Compensation: scrollTo(700 + 30 = 730), then snap: scrollTo(1030 - 300 = 730)
    // Both happen — compensation and snap-to-bottom
    expect(mockCtx.scrollCalls).toContain(730);
    expect(mockCtx.scrollCalls.length).toBeGreaterThanOrEqual(1);

    plugin.destroy();
    mockCtx.cleanup();
  });

  it("compensates scroll for overscan items above the visible viewport edge", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;

    // Step 1: item 3 is in the rendered range, observe it
    state.startIndex = 0;
    state.scrollPosition = 0;
    state.visibleCount = 10;
    for (let i = 0; i < 10; i++) state.visibleIndices[i] = i;

    const el3 = addElement(mockCtx.dom.content, 3);
    plugin.hooks!.onCommit!(state);

    // Step 2: scroll down. startIndex=3 (includes overscan), but
    // scrollPosition=250 means the first truly visible item is 5 (250/50).
    // Item 3 is rendered via overscan but sits above the viewport edge.
    state.startIndex = 3;
    state.scrollPosition = 250;
    state.visibleCount = 10;
    for (let i = 0; i < 10; i++) state.visibleIndices[i] = 3 + i;

    // Measure item 3 at 80px instead of estimated 50px → delta = +30
    triggerMeasurement(el3, 80);

    // Item 3 is above the true first visible (index 5), so scroll
    // compensation fires: scrollTo(250 + 30 = 280)
    expect(mockCtx.scrollCalls).toContain(280);

    plugin.destroy();
    mockCtx.cleanup();
  });

  it("accumulates deltas from multiple items above viewport", () => {
    const { mockCtx, plugin, triggerMeasurement } = setupAnchorTest();
    const state = mockCtx.engineState;

    // Step 1: items 2 and 4 are visible, observe them
    state.startIndex = 0;
    state.scrollPosition = 0;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = i;

    const el2 = addElement(mockCtx.dom.content, 2);
    const el4 = addElement(mockCtx.dom.content, 4);
    plugin.hooks!.onCommit!(state);

    // Step 2: scroll down so both are above viewport
    state.startIndex = 10;
    state.scrollPosition = 500;
    state.visibleCount = 6;
    for (let i = 0; i < 6; i++) state.visibleIndices[i] = 10 + i;

    // Each measurement fires the observer callback independently.
    // Mock doesn't update engineState.scrollPosition, so each uses 500 as base.
    triggerMeasurement(el2, 80); // +30 → scrollTo(500 + 30 = 530)
    triggerMeasurement(el4, 90); // +40 → scrollTo(500 + 40 = 540)

    expect(mockCtx.scrollCalls).toContain(530);
    expect(mockCtx.scrollCalls).toContain(540);

    plugin.destroy();
    mockCtx.cleanup();
  });
});
