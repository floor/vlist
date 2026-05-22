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
