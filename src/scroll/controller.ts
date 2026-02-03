/**
 * vlist - Scroll Controller
 * Handles both native scrolling and manual wheel-based scrolling for compressed lists
 *
 * When compression is active (large lists exceeding browser height limits),
 * we switch from native scrolling to manual wheel event handling.
 * This allows smooth scrolling through millions of items.
 */

import type { CompressionState } from "../render/compression";

// =============================================================================
// Types
// =============================================================================

/** Scroll direction */
export type ScrollDirection = "up" | "down";

/** Scroll event data */
export interface ScrollEventData {
  scrollTop: number;
  direction: ScrollDirection;
  velocity: number;
}

/** Scroll controller configuration */
export interface ScrollControllerConfig {
  /** Enable compressed scroll mode (manual wheel handling) */
  compressed?: boolean;

  /** Compression state for calculating bounds */
  compression?: CompressionState;

  /** Wheel sensitivity multiplier (default: 1) */
  sensitivity?: number;

  /** Enable smooth scrolling interpolation */
  smoothing?: boolean;

  /** Callback when scroll position changes */
  onScroll?: (data: ScrollEventData) => void;

  /** Callback when scrolling becomes idle */
  onIdle?: () => void;
}

/** Scroll controller instance */
export interface ScrollController {
  /** Get current scroll position */
  getScrollTop: () => number;

  /** Set scroll position */
  scrollTo: (position: number, smooth?: boolean) => void;

  /** Scroll by delta */
  scrollBy: (delta: number) => void;

  /** Check if at top */
  isAtTop: () => boolean;

  /** Check if at bottom */
  isAtBottom: (threshold?: number) => boolean;

  /** Get scroll percentage (0-1) */
  getScrollPercentage: () => number;

  /** Get current scroll velocity (px/ms, absolute value) */
  getVelocity: () => number;

  /** Check if currently scrolling */
  isScrolling: () => boolean;

  /** Update configuration (e.g., when compression state changes) */
  updateConfig: (config: Partial<ScrollControllerConfig>) => void;

  /** Enable compressed mode */
  enableCompression: (compression: CompressionState) => void;

  /** Disable compressed mode (revert to native scroll) */
  disableCompression: () => void;

  /** Check if compressed mode is active */
  isCompressed: () => boolean;

  /** Destroy and cleanup */
  destroy: () => void;
}

// =============================================================================
// Velocity Tracker
// =============================================================================

interface VelocityTracker {
  velocity: number;
  lastPosition: number;
  lastTime: number;
  samples: Array<{ position: number; time: number }>;
}

const createVelocityTracker = (initialPosition = 0): VelocityTracker => ({
  velocity: 0,
  lastPosition: initialPosition,
  lastTime: performance.now(),
  samples: [],
});

const updateVelocityTracker = (
  tracker: VelocityTracker,
  newPosition: number,
): VelocityTracker => {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;

  if (timeDelta === 0) return tracker;

  const positionDelta = newPosition - tracker.lastPosition;
  const instantVelocity = positionDelta / timeDelta;

  // Keep recent samples (last 100ms)
  const samples = [
    ...tracker.samples.filter((s) => now - s.time < 100),
    { position: newPosition, time: now },
  ];

  // Calculate average velocity from recent samples
  let avgVelocity = instantVelocity;
  if (samples.length > 1) {
    const oldest = samples[0]!;
    const totalDistance = newPosition - oldest.position;
    const totalTime = now - oldest.time;
    avgVelocity = totalTime > 0 ? totalDistance / totalTime : instantVelocity;
  }

  return {
    velocity: avgVelocity,
    lastPosition: newPosition,
    lastTime: now,
    samples,
  };
};

// =============================================================================
// Scroll Controller Factory
// =============================================================================

/**
 * Create a scroll controller for a viewport element
 *
 * Supports two modes:
 * 1. Native scrolling (default) - uses browser's built-in scroll
 * 2. Compressed scrolling - manual wheel handling for large lists
 */
export const createScrollController = (
  viewport: HTMLElement,
  config: ScrollControllerConfig = {},
): ScrollController => {
  const { sensitivity = 1, smoothing = false, onScroll, onIdle } = config;

  // State
  let scrollPosition = 0;
  let maxScroll = 0;
  let compressed = config.compressed ?? false;
  let compression = config.compression;
  let velocityTracker = createVelocityTracker();
  let isScrolling = false;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;

  // =============================================================================
  // Native Scroll Handling
  // =============================================================================

  const handleNativeScroll = (): void => {
    const newPosition = viewport.scrollTop;
    const direction: ScrollDirection =
      newPosition >= scrollPosition ? "down" : "up";

    velocityTracker = updateVelocityTracker(velocityTracker, newPosition);
    scrollPosition = newPosition;

    if (onScroll) {
      onScroll({
        scrollTop: scrollPosition,
        direction,
        velocity: velocityTracker.velocity,
      });
    }

    // Idle detection
    scheduleIdleCheck();
  };

  // =============================================================================
  // Compressed (Manual) Scroll Handling
  // =============================================================================

  const handleWheel = (event: WheelEvent): void => {
    if (!compressed) return;

    event.preventDefault();

    const delta = event.deltaY * sensitivity;
    let newPosition = scrollPosition + delta;

    // Apply smoothing if enabled
    if (smoothing) {
      newPosition = scrollPosition + delta * 0.3;
    }

    // Clamp to valid range
    newPosition = Math.max(0, Math.min(newPosition, maxScroll));

    if (newPosition !== scrollPosition) {
      const previousPosition = scrollPosition;
      const direction: ScrollDirection =
        newPosition >= previousPosition ? "down" : "up";

      velocityTracker = updateVelocityTracker(velocityTracker, newPosition);
      scrollPosition = newPosition;

      if (!isScrolling) {
        isScrolling = true;
      }

      if (onScroll) {
        onScroll({
          scrollTop: scrollPosition,
          direction,
          velocity: velocityTracker.velocity,
        });
      }

      // Idle detection
      scheduleIdleCheck();
    }
  };

  // =============================================================================
  // Idle Detection
  // =============================================================================

  const scheduleIdleCheck = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    idleTimeout = setTimeout(() => {
      isScrolling = false;
      // Reset velocity tracker with current scroll position to avoid
      // calculating huge velocity on next scroll event
      velocityTracker = createVelocityTracker(scrollPosition);

      if (onIdle) {
        onIdle();
      }
    }, 150);
  };

  // =============================================================================
  // Mode Switching
  // =============================================================================

  const enableCompression = (newCompression: CompressionState): void => {
    if (compressed) return;

    compressed = true;
    compression = newCompression;
    maxScroll = newCompression.virtualHeight - viewport.clientHeight;

    // Remove native scroll listener
    viewport.removeEventListener("scroll", handleNativeScroll);

    // Switch to overflow hidden
    viewport.style.overflow = "hidden";

    // Add wheel listener
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    // Convert current scroll position to compressed equivalent
    if (viewport.scrollTop > 0) {
      const ratio =
        viewport.scrollTop /
        (compression?.actualHeight ?? viewport.scrollHeight);
      scrollPosition = ratio * maxScroll;
    }

    // Reset native scroll
    viewport.scrollTop = 0;
  };

  const disableCompression = (): void => {
    if (!compressed) return;

    compressed = false;

    // Remove wheel listener
    viewport.removeEventListener("wheel", handleWheel);

    // Restore native scrolling
    viewport.style.overflow = "auto";

    // Add native scroll listener
    viewport.addEventListener("scroll", handleNativeScroll, { passive: true });

    // Restore scroll position
    if (compression && scrollPosition > 0) {
      const ratio = scrollPosition / maxScroll;
      viewport.scrollTop =
        ratio * (compression.actualHeight - viewport.clientHeight);
    }

    compression = undefined;
  };

  // =============================================================================
  // Public API
  // =============================================================================

  const getScrollTop = (): number => {
    return compressed ? scrollPosition : viewport.scrollTop;
  };

  const scrollTo = (position: number, smooth = false): void => {
    const clampedPosition = Math.max(
      0,
      Math.min(position, maxScroll || Infinity),
    );

    if (compressed) {
      const previousPosition = scrollPosition;
      scrollPosition = clampedPosition;

      if (onScroll) {
        onScroll({
          scrollTop: scrollPosition,
          direction: scrollPosition >= previousPosition ? "down" : "up",
          velocity: 0,
        });
      }
    } else {
      viewport.scrollTo({
        top: clampedPosition,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  const scrollBy = (delta: number): void => {
    scrollTo(getScrollTop() + delta);
  };

  const isAtTop = (): boolean => {
    return getScrollTop() <= 0;
  };

  const isAtBottom = (threshold = 0): boolean => {
    const scrollTop = getScrollTop();
    const max = compressed
      ? maxScroll
      : viewport.scrollHeight - viewport.clientHeight;
    return scrollTop >= max - threshold;
  };

  const getScrollPercentage = (): number => {
    const scrollTop = getScrollTop();
    const max = compressed
      ? maxScroll
      : viewport.scrollHeight - viewport.clientHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, scrollTop / max));
  };

  const updateConfig = (newConfig: Partial<ScrollControllerConfig>): void => {
    if (newConfig.compression) {
      compression = newConfig.compression;
      maxScroll = compression.virtualHeight - viewport.clientHeight;
    }
  };

  const isCompressedMode = (): boolean => compressed;

  const getVelocityValue = (): number => Math.abs(velocityTracker.velocity);

  const getIsScrolling = (): boolean => isScrolling;

  const destroy = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    viewport.removeEventListener("scroll", handleNativeScroll);
    viewport.removeEventListener("wheel", handleWheel);
  };

  // =============================================================================
  // Initialization
  // =============================================================================

  if (compressed && compression) {
    // Start in compressed mode
    maxScroll = compression.virtualHeight - viewport.clientHeight;
    viewport.style.overflow = "hidden";
    viewport.addEventListener("wheel", handleWheel, { passive: false });
  } else {
    // Start in native scroll mode
    viewport.style.overflow = "auto";
    viewport.addEventListener("scroll", handleNativeScroll, { passive: true });
  }

  return {
    getScrollTop,
    scrollTo,
    scrollBy,
    isAtTop,
    isAtBottom,
    getScrollPercentage,
    getVelocity: getVelocityValue,
    isScrolling: getIsScrolling,
    updateConfig,
    enableCompression,
    disableCompression,
    isCompressed: isCompressedMode,
    destroy,
  };
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Throttle scroll handler using requestAnimationFrame
 */
export const rafThrottle = <T extends (...args: any[]) => void>(
  fn: T,
): ((...args: Parameters<T>) => void) & { cancel: () => void } => {
  let frameId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>): void => {
    lastArgs = args;

    if (frameId === null) {
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      });
    }
  };

  throttled.cancel = (): void => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  return throttled;
};

/**
 * Check if scroll position is at bottom
 */
export const isAtBottom = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 0,
): boolean => {
  return scrollTop + clientHeight >= scrollHeight - threshold;
};

/**
 * Check if scroll position is at top
 */
export const isAtTop = (scrollTop: number, threshold = 0): boolean => {
  return scrollTop <= threshold;
};

/**
 * Get scroll percentage (0-1)
 */
export const getScrollPercentage = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number => {
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, scrollTop / maxScroll));
};

/**
 * Check if a range is visible in the scroll viewport
 */
export const isRangeVisible = (
  rangeStart: number,
  rangeEnd: number,
  visibleStart: number,
  visibleEnd: number,
): boolean => {
  return rangeStart <= visibleEnd && rangeEnd >= visibleStart;
};
