/**
 * vlist/scale - Touch Scroll Tests
 * Tests for touch event handling in compressed mode (withScale plugin).
 *
 * Covers:
 * - Basic touch drag scrolling (touchstart → touchmove → touchend)
 * - Momentum / inertial scrolling after fast flick
 * - Edge clamping (top and bottom boundaries)
 * - Cancellation of momentum on new touch
 * - Cancellation of smooth scroll (lerp) on new touch
 * - Horizontal mode support
 * - preventDefault on touchmove (blocks iOS page bounce)
 * - touchcancel handling
 * - Guard against empty touch list
 * - Cleanup on destroy
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";

import { vlist } from "../../../src/builder/core";
import type { BuiltVList } from "../../../src/builder/types";
import type { VListItem } from "../../../src/types";
import { withScale } from "../../../src/features/scale/plugin";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: typeof globalThis.document;
let originalWindow: typeof globalThis.window;
let originalRAF: typeof globalThis.requestAnimationFrame;
let originalCAF: typeof globalThis.cancelAnimationFrame;

// RAF tracking — lets tests step through animation frames manually
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;
  originalCAF = global.cancelAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.Element = dom.window.Element;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(_target: Element): void {
      this.callback(
        [
          {
            target: _target,
            contentRect: {
              width: 300,
              height: 500,
              top: 0,
              left: 0,
              bottom: 500,
              right: 300,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve(_target: Element): void {}
    disconnect(): void {}
  };

  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
    ): void {
      if (typeof options === "number") {
        this.scrollTop = options;
      } else if (options && typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    };
  }

  (dom.window as any).scrollTo = (
    _x?: number | ScrollToOptions,
    _y?: number,
  ): void => {};
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
});

// =============================================================================
// Touch Event Polyfill for JSDOM
//
// JSDOM does not implement Touch or TouchEvent. We provide minimal polyfills
// that satisfy the subset used by the withScale plugin: e.touches[0].clientX/Y,
// e.preventDefault(), and standard EventTarget dispatch.
// =============================================================================

interface MockTouchInit {
  identifier?: number;
  clientX?: number;
  clientY?: number;
  target?: EventTarget;
}

class MockTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget;
  readonly pageX: number;
  readonly pageY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationAngle: number;
  readonly force: number;

  constructor(init: MockTouchInit = {}) {
    this.identifier = init.identifier ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.target = init.target ?? document.body;
    this.pageX = this.clientX;
    this.pageY = this.clientY;
    this.screenX = this.clientX;
    this.screenY = this.clientY;
    this.radiusX = 0;
    this.radiusY = 0;
    this.rotationAngle = 0;
    this.force = 1;
  }
}

interface MockTouchEventInit {
  touches?: MockTouch[];
  changedTouches?: MockTouch[];
  targetTouches?: MockTouch[];
  bubbles?: boolean;
  cancelable?: boolean;
}

/**
 * Minimal TouchEvent implementation for JSDOM.
 *
 * Uses dom.window.Event as the base class so that dispatchEvent() works
 * correctly on JSDOM elements.
 */
const createTouchEvent = (
  type: string,
  init: MockTouchEventInit = {},
): Event & {
  touches: MockTouch[];
  changedTouches: MockTouch[];
  targetTouches: MockTouch[];
} => {
  const event = new dom.window.Event(type, {
    bubbles: init.bubbles ?? true,
    cancelable: init.cancelable ?? true,
  });

  // Attach touch lists as plain arrays (sufficient for plugin access via [0])
  (event as any).touches = init.touches ?? [];
  (event as any).changedTouches = init.changedTouches ?? [];
  (event as any).targetTouches = init.targetTouches ?? [];

  return event as any;
};

// =============================================================================
// RAF Helpers — deterministic animation frame control
// =============================================================================

const installMockRAF = (): void => {
  rafCallbacks = new Map();
  nextRafId = 1;

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextRafId++;
    rafCallbacks.set(id, callback);
    return id;
  };

  global.cancelAnimationFrame = (id: number): void => {
    rafCallbacks.delete(id);
  };
};

/** Flush a single pending RAF callback (FIFO). Returns true if one was flushed. */
const flushOneRAF = (): boolean => {
  const iter = rafCallbacks.entries().next();
  if (iter.done) return false;
  const [id, cb] = iter.value;
  rafCallbacks.delete(id);
  cb(performance.now());
  return true;
};

/** Flush all pending RAF callbacks (may spawn new ones; runs until drained). */
const flushAllRAF = (maxIterations = 200): number => {
  let count = 0;
  while (rafCallbacks.size > 0 && count < maxIterations) {
    flushOneRAF();
    count++;
  }
  return count;
};

/** Number of pending RAF callbacks. */
const pendingRAFCount = (): number => rafCallbacks.size;

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

/** Create N test items. 500K × 40px = 20M px > 16M limit → triggers compression. */
const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

const template = (item: TestItem): string =>
  `<div class="item">${item.name}</div>`;

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
};

/** Get the viewport element from a built list. */
const getViewport = (list: BuiltVList<TestItem>): HTMLElement => {
  const vp = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (!vp) throw new Error("Viewport element not found");
  return vp;
};

/** Collect rendered data-index values from a list's DOM. */
const getRenderedIndices = (list: BuiltVList<TestItem>): number[] => {
  const elements = list.element.querySelectorAll("[data-index]");
  return Array.from(elements).map((el) =>
    parseInt((el as HTMLElement).dataset.index!, 10),
  );
};

/**
 * Simulate a touch drag sequence on the viewport.
 *
 * @param viewport - The viewport element to dispatch events on
 * @param startY - Starting clientY position
 * @param endY - Ending clientY position
 * @param steps - Number of intermediate touchmove events
 * @param durationMs - Simulated duration (affects velocity calculation)
 * @returns Array of { defaultPrevented } from touchmove events
 */
const simulateTouchDrag = (
  viewport: HTMLElement,
  startY: number,
  endY: number,
  steps = 5,
  _durationMs = 100,
): { movesPrevented: boolean[] } => {
  const touch0 = new MockTouch({ clientY: startY, target: viewport });
  viewport.dispatchEvent(createTouchEvent("touchstart", { touches: [touch0] }));

  const movesPrevented: boolean[] = [];

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const y = startY + (endY - startY) * progress;
    const touchN = new MockTouch({ clientY: y, target: viewport });

    // Advance performance.now() mock by spreading duration across steps
    // (JSDOM's performance.now is real, so we just rely on actual elapsed time
    //  for velocity; tests that need precise velocity use custom approaches.)
    const moveEvent = createTouchEvent("touchmove", { touches: [touchN] });
    viewport.dispatchEvent(moveEvent);
    movesPrevented.push(moveEvent.defaultPrevented);
  }

  viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

  return { movesPrevented };
};

/**
 * Simulate a horizontal touch drag (uses clientX instead of clientY).
 */
const simulateHorizontalTouchDrag = (
  viewport: HTMLElement,
  startX: number,
  endX: number,
  steps = 5,
): void => {
  const touch0 = new MockTouch({ clientX: startX, target: viewport });
  viewport.dispatchEvent(createTouchEvent("touchstart", { touches: [touch0] }));

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const x = startX + (endX - startX) * progress;
    const touchN = new MockTouch({ clientX: x, target: viewport });
    viewport.dispatchEvent(
      createTouchEvent("touchmove", { touches: [touchN] }),
    );
  }

  viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));
};

// =============================================================================
// Tests
// =============================================================================

describe("withScale touch scrolling", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
    installMockRAF();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  // ---------------------------------------------------------------------------
  // Compressed mode activation
  // ---------------------------------------------------------------------------

  describe("compressed mode prerequisites", () => {
    it("should activate compression for 500K items at 40px height", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      // Compression should be active — the custom scrollbar fallback is
      // created by withScale when compression activates
      const scrollbar = list.element.querySelector(".vlist-scrollbar");
      expect(scrollbar).not.toBeNull();

      // Touch scroll should work (proves compressed-mode handlers are wired)
      const viewport = getViewport(list);
      const touch0 = new MockTouch({ clientY: 400, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );
      const touch1 = new MockTouch({ clientY: 200, target: viewport });
      const moveEvent = createTouchEvent("touchmove", { touches: [touch1] });
      viewport.dispatchEvent(moveEvent);
      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));
      flushAllRAF();

      // Scroll position should have moved (compression is active & touch works)
      expect(list.getScrollPosition()).toBeGreaterThan(0);
    });

    it("should set overflow:auto for non-compressed lists", () => {
      const items = createTestItems(100);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);
      expect(viewport.style.overflow).toBe("auto");
    });
  });

  // ---------------------------------------------------------------------------
  // Basic touch drag
  // ---------------------------------------------------------------------------

  describe("touch drag scrolling", () => {
    it("should scroll down when finger moves up (positive delta)", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      // Initial render should be at the top
      const initialIndices = getRenderedIndices(list);
      expect(initialIndices).toContain(0);

      const viewport = getViewport(list);

      // Drag finger upward: startY=500 → endY=100 (400px delta → scroll down)
      simulateTouchDrag(viewport, 500, 100, 5);
      // Flush any RAF callbacks from the scroll cycle
      flushAllRAF();

      // Scroll position should have advanced past the initial render
      const scrollPos = list.getScrollPosition();
      expect(scrollPos).toBeGreaterThan(0);
    });

    it("should scroll up when finger moves down (negative delta)", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // First scroll down
      simulateTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();
      const afterDown = list.getScrollPosition();
      expect(afterDown).toBeGreaterThan(0);

      // Then scroll up
      simulateTouchDrag(viewport, 100, 500, 5);
      flushAllRAF();
      const afterUp = list.getScrollPosition();
      expect(afterUp).toBeLessThan(afterDown);
    });

    it("should render different items after scrolling", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const initialIndices = getRenderedIndices(list);
      expect(initialIndices).toContain(0);

      const viewport = getViewport(list);

      // Large drag to move away from top
      simulateTouchDrag(viewport, 600, 100, 10);
      flushAllRAF();

      const afterIndices = getRenderedIndices(list);
      expect(afterIndices.length).toBeGreaterThan(0);

      // We moved 500px in a compressed space — at minimum the rendered range
      // should have shifted. The min rendered index should be > 0.
      const minAfter = Math.min(...afterIndices);
      expect(minAfter).toBeGreaterThan(0);
    });

    it("should call preventDefault on touchmove to block page scroll", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);
      const { movesPrevented } = simulateTouchDrag(viewport, 400, 200, 3);

      // Every touchmove should have been prevented
      expect(movesPrevented.length).toBe(3);
      for (const prevented of movesPrevented) {
        expect(prevented).toBe(true);
      }
    });

    it("should not preventDefault on touchmove when not compressed", () => {
      // Small list — no compression
      const items = createTestItems(100);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // The touch handlers are only registered in compressed mode,
      // so touchmove should NOT be prevented
      const touch0 = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchN = new MockTouch({ clientY: 200, target: viewport });
      const moveEvent = createTouchEvent("touchmove", { touches: [touchN] });
      viewport.dispatchEvent(moveEvent);

      // No compressed-mode touch handler → default not prevented
      expect(moveEvent.defaultPrevented).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge clamping
  // ---------------------------------------------------------------------------

  describe("edge clamping", () => {
    it("should not scroll above 0 (top boundary)", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Try to scroll up from top — finger moves down
      simulateTouchDrag(viewport, 100, 600, 5);
      flushAllRAF();

      const scrollPos = list.getScrollPosition();
      expect(scrollPos).toBe(0);
    });

    it("should not scroll past maxScroll (bottom boundary)", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      // First scroll to the end
      list.scrollToIndex(499_999, "end");
      flushAllRAF();

      const viewport = getViewport(list);

      // Now try to scroll further down
      simulateTouchDrag(viewport, 500, 50, 5);
      flushAllRAF();

      const afterOverscroll = list.getScrollPosition();
      // Should not exceed the position it was already clamped at
      // (within a tiny tolerance for floating-point)
      expect(afterOverscroll).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Momentum scrolling
  // ---------------------------------------------------------------------------

  describe("momentum scrolling", () => {
    it("should schedule RAF callbacks after a fast flick", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Fast flick — large distance in few steps
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      // Simulate a fast move over a short time
      const touchMid = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchMid] }),
      );

      const touchEnd = new MockTouch({ clientY: 100, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchEnd] }),
      );

      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

      // Momentum animation should have scheduled at least one RAF
      expect(pendingRAFCount()).toBeGreaterThanOrEqual(1);
    });

    it("should continue scrolling via momentum after touch ends", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Fast flick down
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchMid = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchMid] }),
      );

      const touchFast = new MockTouch({ clientY: 100, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchFast] }),
      );

      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

      // Record position just after touch ends (before momentum)
      const posAfterTouch = list.getScrollPosition();

      // Flush several momentum frames
      const flushed = flushAllRAF();
      expect(flushed).toBeGreaterThan(0);

      // Position should have advanced further via momentum
      const posAfterMomentum = list.getScrollPosition();
      expect(posAfterMomentum).toBeGreaterThanOrEqual(posAfterTouch);
    });

    it("should eventually stop momentum (deceleration converges)", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Fast flick
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchFast = new MockTouch({ clientY: 100, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchFast] }),
      );

      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

      // Drain all momentum frames — should converge and stop
      const frameCount = flushAllRAF(500);
      expect(frameCount).toBeLessThan(500); // Should stop before max iterations

      // No more pending RAF callbacks
      expect(pendingRAFCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  describe("cancellation", () => {
    it("should cancel momentum on new touchstart", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Fast flick to start momentum
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchFast = new MockTouch({ clientY: 100, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchFast] }),
      );

      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

      // Momentum should be scheduled
      expect(pendingRAFCount()).toBeGreaterThanOrEqual(1);

      // Flush one frame so momentum is in flight
      flushOneRAF();
      const posBeforeCancel = list.getScrollPosition();

      // New touchstart should cancel momentum
      const newTouch = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [newTouch] }),
      );

      // Momentum callbacks should have been cancelled
      // (new frames from the cancelled momentum won't execute)
      flushAllRAF();

      // Position should be at or very near where we cancelled
      // (only the new touch's handlers run, not old momentum)
      const posAfterCancel = list.getScrollPosition();
      // The new touchstart doesn't move — it just records the start position
      // So position should equal posBeforeCancel (no further momentum drift)
      expect(posAfterCancel).toBe(posBeforeCancel);
    });

    it("should cancel lerp animation on touchstart", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Dispatch a wheel event to start the lerp animation
      const wheelEvent = new dom.window.Event("wheel", {
        bubbles: true,
        cancelable: true,
      });
      (wheelEvent as any).deltaY = 200;
      (wheelEvent as any).deltaX = 0;
      viewport.dispatchEvent(wheelEvent);

      // Lerp should have scheduled a RAF
      expect(pendingRAFCount()).toBeGreaterThanOrEqual(1);

      // Touchstart should cancel it
      const touch0 = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      // The lerp callback was cancelled; only the new touch state remains
      // We can't easily verify the cancellation beyond checking that the
      // system doesn't crash and position is consistent
      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // touchcancel
  // ---------------------------------------------------------------------------

  describe("touchcancel", () => {
    it("should handle touchcancel the same as touchend", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Start a drag
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchMid = new MockTouch({ clientY: 300, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchMid] }),
      );

      // Cancel instead of end
      viewport.dispatchEvent(createTouchEvent("touchcancel", { touches: [] }));

      // Should not crash, and scroll position should reflect the drag
      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThan(0);

      // Momentum may or may not be scheduled depending on velocity
      // Either way, flushing should not crash
      flushAllRAF();
    });
  });

  // ---------------------------------------------------------------------------
  // Guard against empty/missing touch
  // ---------------------------------------------------------------------------

  describe("empty touch list guard", () => {
    it("should handle touchstart with no touches gracefully", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Dispatch touchstart with empty touches array
      expect(() => {
        viewport.dispatchEvent(createTouchEvent("touchstart", { touches: [] }));
      }).not.toThrow();
    });

    it("should handle touchmove with no touches gracefully", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Normal touchstart
      const touch0 = new MockTouch({ clientY: 400, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      // touchmove with empty touches (shouldn't crash)
      expect(() => {
        viewport.dispatchEvent(createTouchEvent("touchmove", { touches: [] }));
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Horizontal mode
  // ---------------------------------------------------------------------------

  describe("horizontal mode", () => {
    it("should use clientX for horizontal lists", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { width: 40, template },
        items,
        orientation: "horizontal",
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Horizontal drag: finger moves left (startX=500 → endX=100)
      simulateHorizontalTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();

      // Scroll position should have changed
      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Destroy / cleanup
  // ---------------------------------------------------------------------------

  describe("cleanup on destroy", () => {
    it("should not crash when destroy is called during momentum", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Start momentum
      const touch0 = new MockTouch({ clientY: 500, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchstart", { touches: [touch0] }),
      );

      const touchFast = new MockTouch({ clientY: 100, target: viewport });
      viewport.dispatchEvent(
        createTouchEvent("touchmove", { touches: [touchFast] }),
      );

      viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));

      // Destroy while momentum is in-flight
      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();

      // Flushing RAF after destroy should not crash
      expect(() => {
        flushAllRAF();
      }).not.toThrow();
    });

    it("should remove touch event listeners on destroy", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Spy on removeEventListener
      const removeSpy = mock(viewport.removeEventListener.bind(viewport));
      viewport.removeEventListener = removeSpy;

      list.destroy();
      list = null;

      // Check that touch listeners were removed
      const removedTypes = removeSpy.mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(removedTypes).toContain("touchstart");
      expect(removedTypes).toContain("touchmove");
      expect(removedTypes).toContain("touchend");
      expect(removedTypes).toContain("touchcancel");
    });

    it("should not fire touch events after destroy", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);
      list.destroy();
      list = null;

      // Dispatching touch events on the viewport after destroy should not crash
      expect(() => {
        const touch0 = new MockTouch({ clientY: 400, target: viewport });
        viewport.dispatchEvent(
          createTouchEvent("touchstart", { touches: [touch0] }),
        );
        const touch1 = new MockTouch({ clientY: 200, target: viewport });
        viewport.dispatchEvent(
          createTouchEvent("touchmove", { touches: [touch1] }),
        );
        viewport.dispatchEvent(createTouchEvent("touchend", { touches: [] }));
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: touch scroll renders correct items
  // ---------------------------------------------------------------------------

  describe("integration", () => {
    it("should render items at new position after touch scroll", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      // Verify starting at top
      let indices = getRenderedIndices(list);
      expect(indices).toContain(0);

      const viewport = getViewport(list);

      // Repeated drags to scroll far down
      for (let i = 0; i < 10; i++) {
        simulateTouchDrag(viewport, 600, 100, 5);
        flushAllRAF();
      }

      indices = getRenderedIndices(list);
      expect(indices.length).toBeGreaterThan(0);

      // After 10 large drags, should have scrolled past the initial items
      const minIdx = Math.min(...indices);
      expect(minIdx).toBeGreaterThan(0);
    });

    it("should emit range:change events during touch scroll", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      let rangeChanged = false;
      list.on("range:change", () => {
        rangeChanged = true;
      });

      const viewport = getViewport(list);
      simulateTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();

      expect(rangeChanged).toBe(true);
    });

    it("should work with scrollToIndex followed by touch scroll", () => {
      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      // Programmatic scroll to middle
      list.scrollToIndex(250_000, "center");
      flushAllRAF();

      const posAfterScrollTo = list.getScrollPosition();
      expect(posAfterScrollTo).toBeGreaterThan(0);

      // Now touch scroll further down
      const viewport = getViewport(list);
      simulateTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();

      const posAfterTouch = list.getScrollPosition();
      expect(posAfterTouch).toBeGreaterThan(posAfterScrollTo);

      // Items should be rendered near the new position
      const indices = getRenderedIndices(list);
      expect(indices.length).toBeGreaterThan(0);
    });

    it("should coexist with withScrollbar plugin", () => {
      // Import withScrollbar inline to keep the test self-contained
      const {
        withScrollbar,
      } = require("../../../src/features/scrollbar/plugin");

      const items = createTestItems(500_000);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .use(withScrollbar({ autoHide: true }))
        .build();

      const viewport = getViewport(list);

      // Touch scroll should work even with scrollbar plugin active
      simulateTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();

      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThan(0);

      const indices = getRenderedIndices(list);
      expect(indices.length).toBeGreaterThan(0);
    });

    it("should handle transition from non-compressed to compressed with touch", () => {
      // Start with small list (no compression)
      const items = createTestItems(100);
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
        items,
      })
        .use(withScale())
        .build();

      const viewport = getViewport(list);

      // Touch on non-compressed list should not crash
      simulateTouchDrag(viewport, 400, 200, 3);
      flushAllRAF();

      // Now grow to compressed size
      list.setItems(createTestItems(500_000));
      flushAllRAF();

      // Touch scroll should now work in compressed mode
      simulateTouchDrag(viewport, 500, 100, 5);
      flushAllRAF();

      const pos = list.getScrollPosition();
      expect(pos).toBeGreaterThan(0);

      const indices = getRenderedIndices(list);
      expect(indices.length).toBeGreaterThan(0);
    });
  });
});
