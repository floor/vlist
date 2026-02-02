/**
 * vlist - Scroll Handling Tests
 * Tests for scroll controller and utilities
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  rafThrottle,
  isAtBottom,
  isAtTop,
  getScrollPercentage,
  isRangeVisible,
} from "../src/core/scroll";

// Mock requestAnimationFrame for testing
let rafCallbacks: Array<() => void> = [];
let rafId = 0;

const mockRaf = (callback: () => void): number => {
  rafCallbacks.push(callback);
  return ++rafId;
};

const mockCancelRaf = (id: number): void => {
  // In real implementation, this would cancel the callback
};

const flushRaf = (): void => {
  const callbacks = [...rafCallbacks];
  rafCallbacks = [];
  callbacks.forEach((cb) => cb());
};

describe("rafThrottle", () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    // @ts-expect-error - mocking global
    globalThis.requestAnimationFrame = mockRaf;
    // @ts-expect-error - mocking global
    globalThis.cancelAnimationFrame = mockCancelRaf;
  });

  it("should throttle function calls to animation frame", () => {
    const fn = mock(() => {});
    const throttled = rafThrottle(fn);

    throttled();
    throttled();
    throttled();

    expect(fn).not.toHaveBeenCalled();

    flushRaf();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should pass arguments to throttled function", () => {
    const fn = mock((...args: unknown[]) => {});
    const throttled = rafThrottle(fn);

    throttled(1, 2, 3);
    flushRaf();

    expect(fn).toHaveBeenCalledWith(1, 2, 3);
  });

  it("should use latest arguments when called multiple times", () => {
    const fn = mock((...args: unknown[]) => {});
    const throttled = rafThrottle(fn);

    throttled("first");
    throttled("second");
    throttled("third");
    flushRaf();

    expect(fn).toHaveBeenCalledWith("third");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should allow new calls after frame completes", () => {
    const fn = mock(() => {});
    const throttled = rafThrottle(fn);

    throttled();
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled();
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should have a cancel method", () => {
    const fn = mock(() => {});
    const throttled = rafThrottle(fn);

    expect(typeof throttled.cancel).toBe("function");
  });

  it("should not call function after cancel", () => {
    const fn = mock(() => {});
    const throttled = rafThrottle(fn);

    throttled();
    throttled.cancel();
    flushRaf();

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("isAtBottom", () => {
  const createMockElement = (
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number,
  ): HTMLElement => {
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
    } as HTMLElement;
  };

  it("should return true when scrolled to bottom", () => {
    const element = createMockElement(500, 1000, 500);

    expect(isAtBottom(element)).toBe(true);
  });

  it("should return false when not at bottom", () => {
    const element = createMockElement(0, 1000, 500);

    expect(isAtBottom(element)).toBe(false);
  });

  it("should respect threshold parameter", () => {
    const element = createMockElement(490, 1000, 500);

    expect(isAtBottom(element, 1)).toBe(false);
    expect(isAtBottom(element, 10)).toBe(true);
    expect(isAtBottom(element, 15)).toBe(true);
  });

  it("should return true when content is smaller than viewport", () => {
    const element = createMockElement(0, 300, 500);

    expect(isAtBottom(element)).toBe(true);
  });

  it("should handle fractional scroll positions", () => {
    const element = createMockElement(499.5, 1000, 500);

    expect(isAtBottom(element, 1)).toBe(true);
  });
});

describe("isAtTop", () => {
  const createMockElement = (scrollTop: number): HTMLElement => {
    return { scrollTop } as HTMLElement;
  };

  it("should return true when at top", () => {
    const element = createMockElement(0);

    expect(isAtTop(element)).toBe(true);
  });

  it("should return false when scrolled down", () => {
    const element = createMockElement(100);

    expect(isAtTop(element)).toBe(false);
  });

  it("should respect threshold parameter", () => {
    const element = createMockElement(5);

    expect(isAtTop(element, 1)).toBe(false);
    expect(isAtTop(element, 5)).toBe(true);
    expect(isAtTop(element, 10)).toBe(true);
  });

  it("should handle fractional scroll positions", () => {
    const element = createMockElement(0.5);

    expect(isAtTop(element, 1)).toBe(true);
    expect(isAtTop(element, 0.3)).toBe(false);
  });
});

describe("getScrollPercentage", () => {
  const createMockElement = (
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number,
  ): HTMLElement => {
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
    } as HTMLElement;
  };

  it("should return 0 at top", () => {
    const element = createMockElement(0, 1000, 500);

    expect(getScrollPercentage(element)).toBe(0);
  });

  it("should return 1 at bottom", () => {
    const element = createMockElement(500, 1000, 500);

    expect(getScrollPercentage(element)).toBe(1);
  });

  it("should return correct percentage in middle", () => {
    const element = createMockElement(250, 1000, 500);

    expect(getScrollPercentage(element)).toBe(0.5);
  });

  it("should return 0 when content is smaller than viewport", () => {
    const element = createMockElement(0, 300, 500);

    expect(getScrollPercentage(element)).toBe(0);
  });

  it("should clamp to 0-1 range", () => {
    // Negative scroll (shouldn't happen but handle gracefully)
    const element1 = createMockElement(-10, 1000, 500);
    expect(getScrollPercentage(element1)).toBe(0);

    // Over-scroll
    const element2 = createMockElement(600, 1000, 500);
    expect(getScrollPercentage(element2)).toBe(1);
  });

  it("should handle various content sizes", () => {
    const element = createMockElement(100, 600, 400);
    // maxScroll = 600 - 400 = 200
    // percentage = 100 / 200 = 0.5

    expect(getScrollPercentage(element)).toBe(0.5);
  });
});

describe("isRangeVisible", () => {
  it("should return true when range is fully visible", () => {
    const range = { start: 10, end: 20 };
    const visibleRange = { start: 5, end: 25 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });

  it("should return true when range is partially visible (start)", () => {
    const range = { start: 0, end: 10 };
    const visibleRange = { start: 5, end: 25 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });

  it("should return true when range is partially visible (end)", () => {
    const range = { start: 20, end: 30 };
    const visibleRange = { start: 5, end: 25 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });

  it("should return false when range is completely before visible", () => {
    const range = { start: 0, end: 4 };
    const visibleRange = { start: 5, end: 25 };

    expect(isRangeVisible(range, visibleRange)).toBe(false);
  });

  it("should return false when range is completely after visible", () => {
    const range = { start: 30, end: 40 };
    const visibleRange = { start: 5, end: 25 };

    expect(isRangeVisible(range, visibleRange)).toBe(false);
  });

  it("should return true when range encompasses visible range", () => {
    const range = { start: 0, end: 50 };
    const visibleRange = { start: 10, end: 20 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });

  it("should return true when ranges touch at boundary", () => {
    const range = { start: 0, end: 10 };
    const visibleRange = { start: 10, end: 20 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });

  it("should handle single-item ranges", () => {
    const range = { start: 15, end: 15 };
    const visibleRange = { start: 10, end: 20 };

    expect(isRangeVisible(range, visibleRange)).toBe(true);
  });
});
