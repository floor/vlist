/**
 * vlist - builder/scroll.ts Tests
 * Tests for scroll utility functions: easing and argument resolution
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  easeInOutQuad,
  resolveScrollArgs,
  createSmoothScroll,
  DEFAULT_SMOOTH_DURATION,
} from "../../src/builder/scroll";

// =============================================================================
// Easing Function Tests
// =============================================================================

describe("easeInOutQuad", () => {
  it("should return 0 at t=0", () => {
    expect(easeInOutQuad(0)).toBe(0);
  });

  it("should return 1 at t=1", () => {
    expect(easeInOutQuad(1)).toBe(1);
  });

  it("should return 0.5 at t=0.5", () => {
    expect(easeInOutQuad(0.5)).toBe(0.5);
  });

  it("should ease in for first half (t < 0.5)", () => {
    const t1 = 0.25;
    const t2 = 0.5;
    const v1 = easeInOutQuad(t1);
    const v2 = easeInOutQuad(t2);

    // Should be accelerating (ease in)
    // The change from 0->0.25 should be less than 0.25 (slow start)
    expect(v1).toBeLessThan(t1);
    expect(v1).toBeCloseTo(0.125, 3);
  });

  it("should ease out for second half (t >= 0.5)", () => {
    const t1 = 0.75;
    const t2 = 1.0;
    const v1 = easeInOutQuad(t1);
    const v2 = easeInOutQuad(t2);

    // Should be decelerating (ease out)
    // The change from 0.75->1.0 should be less than 0.25 (slow end)
    expect(v2 - v1).toBeLessThan(0.25);
    expect(v1).toBeCloseTo(0.875, 3);
  });

  it("should be symmetric around 0.5", () => {
    const t = 0.3;
    const v1 = easeInOutQuad(t);
    const v2 = easeInOutQuad(1 - t);

    // easeInOutQuad(t) + easeInOutQuad(1-t) should equal 1
    expect(v1 + v2).toBeCloseTo(1, 10);
  });

  it("should handle edge case t=0.25", () => {
    const result = easeInOutQuad(0.25);
    // 2 * 0.25 * 0.25 = 0.125
    expect(result).toBeCloseTo(0.125, 10);
  });

  it("should handle edge case t=0.75", () => {
    const result = easeInOutQuad(0.75);
    // -1 + (4 - 2*0.75) * 0.75 = -1 + 2.5 * 0.75 = -1 + 1.875 = 0.875
    expect(result).toBeCloseTo(0.875, 10);
  });

  it("should be continuous at t=0.5", () => {
    const before = easeInOutQuad(0.499);
    const at = easeInOutQuad(0.5);
    const after = easeInOutQuad(0.501);

    // Should be very close (continuous function)
    expect(Math.abs(at - before)).toBeLessThan(0.01);
    expect(Math.abs(after - at)).toBeLessThan(0.01);
  });
});

// =============================================================================
// Argument Resolution Tests
// =============================================================================

describe("resolveScrollArgs", () => {
  it("should use defaults when called with no arguments", () => {
    const result = resolveScrollArgs();

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should resolve string argument as align", () => {
    const result = resolveScrollArgs("center");

    expect(result.align).toBe("center");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should resolve 'start' string", () => {
    const result = resolveScrollArgs("start");

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should resolve 'end' string", () => {
    const result = resolveScrollArgs("end");

    expect(result.align).toBe("end");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should resolve object with all properties", () => {
    const result = resolveScrollArgs({
      align: "center",
      behavior: "smooth",
      duration: 500,
    });

    expect(result.align).toBe("center");
    expect(result.behavior).toBe("smooth");
    expect(result.duration).toBe(500);
  });

  it("should use defaults for missing object properties", () => {
    const result = resolveScrollArgs({});

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should use defaults for undefined object properties", () => {
    const result = resolveScrollArgs({
      align: undefined,
      behavior: undefined,
      duration: undefined,
    });

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should override only specified properties", () => {
    const result = resolveScrollArgs({
      align: "end",
    });

    expect(result.align).toBe("end");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should handle custom duration only", () => {
    const result = resolveScrollArgs({
      duration: 1000,
    });

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("auto");
    expect(result.duration).toBe(1000);
  });

  it("should handle smooth behavior only", () => {
    const result = resolveScrollArgs({
      behavior: "smooth",
    });

    expect(result.align).toBe("start");
    expect(result.behavior).toBe("smooth");
    expect(result.duration).toBe(DEFAULT_SMOOTH_DURATION);
  });

  it("should handle all custom values", () => {
    const result = resolveScrollArgs({
      align: "center",
      behavior: "smooth",
      duration: 750,
    });

    expect(result.align).toBe("center");
    expect(result.behavior).toBe("smooth");
    expect(result.duration).toBe(750);
  });

  it("should handle zero duration", () => {
    const result = resolveScrollArgs({
      duration: 0,
    });

    expect(result.duration).toBe(0);
  });

  it("should handle very short duration", () => {
    const result = resolveScrollArgs({
      duration: 1,
    });

    expect(result.duration).toBe(1);
  });

  it("should handle very long duration", () => {
    const result = resolveScrollArgs({
      duration: 5000,
    });

    expect(result.duration).toBe(5000);
  });

  it("should handle object with extra properties", () => {
    const result = resolveScrollArgs({
      align: "center",
      behavior: "smooth",
      duration: 500,
      extra: "ignored",
    } as any);

    expect(result.align).toBe("center");
    expect(result.behavior).toBe("smooth");
    expect(result.duration).toBe(500);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Scroll utilities integration", () => {
  it("should work together for smooth scroll animation", () => {
    const options = resolveScrollArgs({
      align: "center",
      behavior: "smooth",
      duration: 300,
    });

    expect(options.behavior).toBe("smooth");
    expect(options.duration).toBe(300);

    // Simulate animation progress
    const progress = easeInOutQuad(0.5);
    expect(progress).toBe(0.5);
  });

  it("should work together for instant scroll", () => {
    const options = resolveScrollArgs("start");

    expect(options.behavior).toBe("auto");
    expect(options.align).toBe("start");
  });

  it("should provide sensible defaults for basic usage", () => {
    const options = resolveScrollArgs();

    // Should be instant scroll to start
    expect(options.align).toBe("start");
    expect(options.behavior).toBe("auto");
    expect(options.duration).toBeGreaterThan(0);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("Constants", () => {
  it("should export DEFAULT_SMOOTH_DURATION", () => {
    expect(DEFAULT_SMOOTH_DURATION).toBeDefined();
    expect(DEFAULT_SMOOTH_DURATION).toBeGreaterThan(0);
    expect(DEFAULT_SMOOTH_DURATION).toBe(300);
  });
});

// =============================================================================
// createSmoothScroll Tests
// =============================================================================

describe("createSmoothScroll", () => {
  // Use synchronous rAF for deterministic tests
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;
  let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }>;
  let nextId: number;

  beforeAll(() => {
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    rafCallbacks = [];
    nextId = 1;

    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      const id = nextId++;
      rafCallbacks.push({ id, cb });
      return id;
    };

    globalThis.cancelAnimationFrame = (id: number): void => {
      rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
    };
  });

  beforeEach(() => {
    rafCallbacks = [];
    nextId = 1;
  });

  afterAll(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  });

  /** Flush all pending rAF callbacks with the given timestamp */
  function flushRAF(now: number) {
    const pending = [...rafCallbacks];
    rafCallbacks = [];
    for (const { cb } of pending) {
      cb(now);
    }
  }

  it("should jump directly when distance < 1px", () => {
    const scrollTo = mock(() => {});
    const renderFn = mock(() => {});
    const controller = { scrollTo, getScrollTop: () => 0 };

    const { animateScroll } = createSmoothScroll(controller, renderFn);

    animateScroll(100, 100.5, 300);

    // Should jump immediately without rAF
    expect(scrollTo).toHaveBeenCalledWith(100.5);
    expect(renderFn).not.toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(0);
  });

  it("should animate over multiple frames", () => {
    const positions: number[] = [];
    const scrollTo = mock((pos: number) => positions.push(pos));
    const renderFn = mock(() => {});
    const controller = { scrollTo, getScrollTop: () => 0 };

    const { animateScroll } = createSmoothScroll(controller, renderFn);

    // Mock performance.now to return a known start time
    const startTime = 1000;
    const originalPerfNow = performance.now;
    performance.now = () => startTime;

    animateScroll(0, 1000, 300);

    performance.now = originalPerfNow;

    // First rAF should be queued
    expect(rafCallbacks.length).toBe(1);

    // Simulate mid-animation frame (t=0.5 → 150ms elapsed)
    flushRAF(startTime + 150);

    expect(scrollTo).toHaveBeenCalled();
    expect(renderFn).toHaveBeenCalled();
    // Should still be animating (another rAF queued)
    expect(rafCallbacks.length).toBe(1);

    // Position at t=0.5: easeInOutQuad(0.5) = 0.5, so pos = 500
    expect(positions[0]).toBeCloseTo(500, 0);

    // Simulate final frame (t=1.0 → 300ms elapsed)
    flushRAF(startTime + 300);

    // Should have reached the target
    expect(positions[positions.length - 1]).toBe(1000);
    // No more rAFs queued (animation complete)
    expect(rafCallbacks.length).toBe(0);
  });

  it("should cancel previous animation when starting a new one", () => {
    const scrollTo = mock(() => {});
    const renderFn = mock(() => {});
    const controller = { scrollTo, getScrollTop: () => 0 };

    const startTime = 2000;
    const originalPerfNow = performance.now;
    performance.now = () => startTime;

    const { animateScroll } = createSmoothScroll(controller, renderFn);

    animateScroll(0, 500, 300);
    expect(rafCallbacks.length).toBe(1);

    // Start a new animation — should cancel the first
    animateScroll(0, 1000, 300);
    expect(rafCallbacks.length).toBe(1); // Old one cancelled, new one queued

    performance.now = originalPerfNow;
  });

  it("cancelScroll should stop the animation", () => {
    const scrollTo = mock(() => {});
    const renderFn = mock(() => {});
    const controller = { scrollTo, getScrollTop: () => 0 };

    const startTime = 3000;
    const originalPerfNow = performance.now;
    performance.now = () => startTime;

    const { animateScroll, cancelScroll } = createSmoothScroll(controller, renderFn);

    animateScroll(0, 1000, 300);
    expect(rafCallbacks.length).toBe(1);

    cancelScroll();
    expect(rafCallbacks.length).toBe(0);

    performance.now = originalPerfNow;
  });

  it("cancelScroll should be safe to call when no animation is running", () => {
    const controller = { scrollTo: mock(() => {}), getScrollTop: () => 0 };
    const { cancelScroll } = createSmoothScroll(controller, () => {});

    expect(() => cancelScroll()).not.toThrow();
  });

  it("should apply easing during animation", () => {
    const positions: number[] = [];
    const scrollTo = mock((pos: number) => positions.push(pos));
    const controller = { scrollTo, getScrollTop: () => 0 };

    const startTime = 4000;
    const originalPerfNow = performance.now;
    performance.now = () => startTime;

    const { animateScroll } = createSmoothScroll(controller, () => {});

    animateScroll(0, 1000, 400);

    // Quarter way: t=0.25, easeInOutQuad(0.25) = 0.125, pos = 125
    flushRAF(startTime + 100);
    expect(positions[0]).toBeCloseTo(125, 0);

    // Three-quarter way: t=0.75, easeInOutQuad(0.75) = 0.875, pos = 875
    flushRAF(startTime + 300);
    expect(positions[1]).toBeCloseTo(875, 0);

    // Complete
    flushRAF(startTime + 400);
    expect(positions[2]).toBe(1000);

    performance.now = originalPerfNow;
  });
});
