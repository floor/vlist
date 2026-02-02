/**
 * vlist - Scroll Handling
 * Efficient scroll handling with RAF optimization
 */

import type { Range } from "../types";

// =============================================================================
// Types
// =============================================================================

/** Scroll handler callback */
export type ScrollCallback = (
  scrollTop: number,
  direction: "up" | "down",
) => void;

/** Scroll controller instance */
export interface ScrollController {
  /** Get current scroll position */
  getScrollTop: () => number;

  /** Set scroll position */
  setScrollTop: (value: number) => void;

  /** Scroll to a specific position with optional smooth behavior */
  scrollTo: (position: number, smooth?: boolean) => void;

  /** Add scroll listener */
  onScroll: (callback: ScrollCallback) => () => void;

  /** Destroy and cleanup */
  destroy: () => void;
}

// =============================================================================
// RAF Throttle
// =============================================================================

/**
 * Create a RAF-throttled function
 * Ensures the function is called at most once per animation frame
 */
export const rafThrottle = <T extends (...args: unknown[]) => void>(
  fn: T,
): ((...args: Parameters<T>) => void) & { cancel: () => void } => {
  let rafId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>): void => {
    lastArgs = args;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      });
    }
  };

  throttled.cancel = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastArgs = null;
  };

  return throttled;
};

// =============================================================================
// Scroll Controller
// =============================================================================

/**
 * Create a scroll controller for a viewport element
 */
export const createScrollController = (
  viewport: HTMLElement,
): ScrollController => {
  let lastScrollTop = 0;
  const listeners = new Set<ScrollCallback>();
  let isDestroyed = false;

  /**
   * Handle scroll event (RAF-throttled)
   */
  const handleScroll = rafThrottle((): void => {
    if (isDestroyed) return;

    const scrollTop = viewport.scrollTop;
    const direction = scrollTop >= lastScrollTop ? "down" : "up";

    // Notify listeners
    listeners.forEach((callback) => {
      try {
        callback(scrollTop, direction);
      } catch (error) {
        console.error("[vlist] Error in scroll handler:", error);
      }
    });

    lastScrollTop = scrollTop;
  });

  // Attach scroll listener
  viewport.addEventListener("scroll", handleScroll, { passive: true });

  /**
   * Get current scroll position
   */
  const getScrollTop = (): number => viewport.scrollTop;

  /**
   * Set scroll position directly
   */
  const setScrollTop = (value: number): void => {
    viewport.scrollTop = value;
    lastScrollTop = value;
  };

  /**
   * Scroll to a specific position
   */
  const scrollTo = (position: number, smooth: boolean = false): void => {
    if (smooth) {
      viewport.scrollTo({
        top: position,
        behavior: "smooth",
      });
    } else {
      viewport.scrollTop = position;
    }
    lastScrollTop = position;
  };

  /**
   * Add scroll listener
   */
  const onScroll = (callback: ScrollCallback): (() => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };

  /**
   * Destroy and cleanup
   */
  const destroy = (): void => {
    isDestroyed = true;
    handleScroll.cancel();
    viewport.removeEventListener("scroll", handleScroll);
    listeners.clear();
  };

  return {
    getScrollTop,
    setScrollTop,
    scrollTo,
    onScroll,
    destroy,
  };
};

// =============================================================================
// Infinite Scroll Detection
// =============================================================================

/** Infinite scroll options */
export interface InfiniteScrollOptions {
  /** Threshold in pixels from bottom to trigger load (default: 200) */
  threshold?: number;

  /** Callback when threshold is reached */
  onLoadMore: () => void;
}

/**
 * Create an infinite scroll detector
 */
export const createInfiniteScroll = (
  viewport: HTMLElement,
  content: HTMLElement,
  options: InfiniteScrollOptions,
): { destroy: () => void } => {
  const { threshold = 200, onLoadMore } = options;
  let isDestroyed = false;

  /**
   * Check if we should load more
   */
  const checkLoadMore = rafThrottle((): void => {
    if (isDestroyed) return;

    const scrollTop = viewport.scrollTop;
    const viewportHeight = viewport.clientHeight;
    const contentHeight = content.clientHeight;

    const distanceFromBottom = contentHeight - scrollTop - viewportHeight;

    if (distanceFromBottom <= threshold) {
      onLoadMore();
    }
  });

  // Attach scroll listener
  viewport.addEventListener("scroll", checkLoadMore, { passive: true });

  /**
   * Destroy and cleanup
   */
  const destroy = (): void => {
    isDestroyed = true;
    checkLoadMore.cancel();
    viewport.removeEventListener("scroll", checkLoadMore);
  };

  return { destroy };
};

// =============================================================================
// Scroll Utilities
// =============================================================================

/**
 * Check if an element is scrolled to the bottom
 */
export const isAtBottom = (
  viewport: HTMLElement,
  threshold: number = 1,
): boolean => {
  const { scrollTop, scrollHeight, clientHeight } = viewport;
  return scrollTop + clientHeight >= scrollHeight - threshold;
};

/**
 * Check if an element is scrolled to the top
 */
export const isAtTop = (
  viewport: HTMLElement,
  threshold: number = 1,
): boolean => {
  return viewport.scrollTop <= threshold;
};

/**
 * Get scroll percentage (0-1)
 */
export const getScrollPercentage = (viewport: HTMLElement): number => {
  const { scrollTop, scrollHeight, clientHeight } = viewport;
  const maxScroll = scrollHeight - clientHeight;

  if (maxScroll <= 0) return 0;

  return Math.min(1, Math.max(0, scrollTop / maxScroll));
};

/**
 * Calculate if a range is visible in the viewport
 */
export const isRangeVisible = (range: Range, visibleRange: Range): boolean => {
  return range.start <= visibleRange.end && range.end >= visibleRange.start;
};
