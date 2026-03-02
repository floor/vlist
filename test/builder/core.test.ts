/**
 * vlist - Builder Core Tests
 *
 * NOTE: The builder core (src/builder/core.ts) is extensively tested through
 * integration tests in builder/index.test.ts (233 tests, 531 assertions).
 * Those tests exercise the full vlist().use().build() pipeline covering:
 *
 * - Builder creation and configuration validation
 * - Feature registration and priority ordering
 * - .build() lifecycle (resolve config → create DOM → create components → run features → wire events)
 * - All built-in features (withSelection, withScrollbar, withAsync, withScale,
 *   withSnapshots, withGrid, withGroups) and their combinations
 * - Reverse mode, horizontal mode, scroll config, keyboard navigation
 * - Template rendering, velocity-aware loading, sticky headers
 * - Grid scroll virtualization integration
 * - Destroy lifecycle and cleanup
 *
 * Coverage: 86.34% lines, 81.48% functions.
 * Uncovered lines are primarily error paths, compression branches,
 * and window mode paths that require a real browser environment.
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add unit tests here for core.ts internals not reachable through
 * the builder integration tests.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../src/builder/core";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;

  global.ResizeObserver = class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width: 400, height: 600 } as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ] as any,
        this as any,
      );
    }
    unobserve() {}
    disconnect() {}
  } as any;

  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));

const createContainer = (): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
  document.body.appendChild(el);
  return el;
};

/**
 * Create a WheelEvent with the given deltas.
 * JSDOM's WheelEvent constructor doesn't always support deltaX/deltaY in the
 * init dict, so we patch them onto the event object after creation.
 */
const createWheelEvent = (deltaX: number, deltaY: number): WheelEvent => {
  const evt = new dom.window.Event("wheel", {
    bubbles: true,
    cancelable: true,
  }) as WheelEvent;
  Object.defineProperty(evt, "deltaX", { value: deltaX });
  Object.defineProperty(evt, "deltaY", { value: deltaY });
  return evt;
};

// =============================================================================
// Smoke Tests
// =============================================================================

describe("builder/core.ts (see index.test.ts for full coverage)", () => {
  it("should export vlist builder function", () => {
    expect(typeof vlist).toBe("function");
  });

  it("should return a builder with use() and build() methods", () => {
    const builder = vlist({
      container: document.createElement("div"),
      item: {
        height: 40,
        template: () => "",
      },
    });

    expect(typeof builder.use).toBe("function");
    expect(typeof builder.build).toBe("function");
  });

  it("should support method chaining on use()", () => {
    const builder = vlist({
      container: document.createElement("div"),
      item: {
        height: 40,
        template: () => "",
      },
    });

    const result = builder.use({
      name: "testFeature",
      priority: 50,
      setup: () => {},
    });

    // use() returns the builder for chaining
    expect(typeof result.use).toBe("function");
    expect(typeof result.build).toBe("function");
  });
});

// =============================================================================
// Wheel Handler — Horizontal Scroll Support
// =============================================================================
// The wheel handler in vertical mode intercepts wheel events and calls
// preventDefault() + applies deltaY manually for synchronous rendering.
// This blocked horizontal scrolling because deltaX was swallowed.
//
// The fix:
// 1. When viewport has horizontal overflow AND the gesture is predominantly
//    horizontal (|deltaX| > |deltaY|), let the browser handle it natively.
// 2. For diagonal/vertical gestures, still intercept for sync rendering but
//    also forward deltaX to viewport.scrollLeft.

describe("wheel handler — horizontal scroll passthrough", () => {
  let container: HTMLElement;
  let list: ReturnType<typeof vlist<TestItem>> extends { build(): infer R } ? R : never;

  const buildList = () => {
    container = createContainer();
    list = vlist<TestItem>({
      container,
      item: { height: 40, template: (item: TestItem) => `<div>${item.name}</div>` },
      items: createTestItems(100),
    }).build();
  };

  afterEach(() => {
    if (list) {
      list.destroy();
      (list as any) = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  /**
   * Helper: get the viewport element and simulate horizontal overflow by
   * making scrollWidth > clientWidth.
   */
  const getViewportWithHorizontalOverflow = (overflowPx = 200): HTMLElement => {
    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    // Simulate horizontal overflow (e.g. table columns wider than viewport)
    Object.defineProperty(viewport, "scrollWidth", {
      value: viewport.clientWidth + overflowPx,
      configurable: true,
    });
    // Make scrollLeft writable for assertions
    let _scrollLeft = 0;
    Object.defineProperty(viewport, "scrollLeft", {
      get: () => _scrollLeft,
      set: (v: number) => { _scrollLeft = v; },
      configurable: true,
    });
    return viewport;
  };

  it("should not preventDefault on predominantly horizontal wheel when viewport has horizontal overflow", () => {
    buildList();
    const viewport = getViewportWithHorizontalOverflow();

    // Horizontal trackpad gesture: |deltaX| > |deltaY|
    const evt = createWheelEvent(80, 5);
    let defaultPrevented = false;
    Object.defineProperty(evt, "preventDefault", {
      value: () => { defaultPrevented = true; },
    });

    viewport.dispatchEvent(evt);

    // The handler should return early — no preventDefault
    expect(defaultPrevented).toBe(false);
  });

  it("should still preventDefault on vertical wheel even when viewport has horizontal overflow", () => {
    buildList();
    const viewport = getViewportWithHorizontalOverflow();

    // Vertical wheel: |deltaY| > |deltaX|
    const evt = createWheelEvent(0, 100);
    let defaultPrevented = false;
    Object.defineProperty(evt, "preventDefault", {
      value: () => { defaultPrevented = true; },
    });

    viewport.dispatchEvent(evt);

    // Vertical scroll should still be intercepted
    expect(defaultPrevented).toBe(true);
  });

  it("should forward deltaX to scrollLeft on diagonal gestures with horizontal overflow", () => {
    buildList();
    const viewport = getViewportWithHorizontalOverflow();

    // Diagonal gesture: deltaY dominant but deltaX non-zero
    const evt = createWheelEvent(30, 80);
    Object.defineProperty(evt, "preventDefault", { value: () => {} });

    viewport.dispatchEvent(evt);

    // deltaX should be forwarded to scrollLeft
    expect(viewport.scrollLeft).toBe(30);
  });

  it("should not forward deltaX when viewport has no horizontal overflow", () => {
    buildList();
    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;

    // No horizontal overflow: scrollWidth <= clientWidth (default)
    Object.defineProperty(viewport, "scrollWidth", {
      value: viewport.clientWidth,
      configurable: true,
    });
    let _scrollLeft = 0;
    Object.defineProperty(viewport, "scrollLeft", {
      get: () => _scrollLeft,
      set: (v: number) => { _scrollLeft = v; },
      configurable: true,
    });

    const evt = createWheelEvent(30, 80);
    Object.defineProperty(evt, "preventDefault", { value: () => {} });

    viewport.dispatchEvent(evt);

    // No horizontal overflow → deltaX should NOT be forwarded
    expect(viewport.scrollLeft).toBe(0);
  });

  it("should not forward deltaX when deltaX is zero", () => {
    buildList();
    const viewport = getViewportWithHorizontalOverflow();

    // Pure vertical scroll — deltaX is 0
    const evt = createWheelEvent(0, 100);
    Object.defineProperty(evt, "preventDefault", { value: () => {} });

    viewport.dispatchEvent(evt);

    expect(viewport.scrollLeft).toBe(0);
  });

  it("should accumulate deltaX over multiple diagonal wheel events", () => {
    buildList();
    const viewport = getViewportWithHorizontalOverflow();

    // Two diagonal gestures
    for (const dx of [20, 35]) {
      const evt = createWheelEvent(dx, 80);
      Object.defineProperty(evt, "preventDefault", { value: () => {} });
      viewport.dispatchEvent(evt);
    }

    // scrollLeft should be the sum of both deltaX values
    expect(viewport.scrollLeft).toBe(55);
  });
});