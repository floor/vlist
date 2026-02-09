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

  /**
   * External scroll element for window/document scrolling.
   * When set, the controller listens to this element's scroll events
   * and computes list-relative positions from the viewport's bounding rect.
   */
  scrollElement?: Window;

  /** Wheel sensitivity multiplier (default: 1) */
  sensitivity?: number;

  /** Enable smooth scrolling interpolation */
  smoothing?: boolean;

  /** Scroll idle detection timeout in ms (default: 150) */
  idleTimeout?: number;

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

  /**
   * Check if the velocity tracker is actively tracking with enough samples.
   * Returns false during ramp-up (first few frames of a new scroll gesture)
   * when the tracker doesn't have enough samples yet.
   */
  isTracking: () => boolean;

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

  /** Check if in window scroll mode */
  isWindowMode: () => boolean;

  /**
   * Update the container height used for scroll calculations.
   * In window mode, call this when the window resizes.
   */
  updateContainerHeight: (height: number) => void;

  /** Destroy and cleanup */
  destroy: () => void;
}

// =============================================================================
// Velocity Tracker (Circular Buffer)
// =============================================================================

/** Number of samples in circular buffer (avoids array allocation on every update) */
const VELOCITY_SAMPLE_COUNT = 8;

/** Minimum samples needed before velocity readings are considered reliable */
const MIN_RELIABLE_SAMPLES = 3;

/**
 * Maximum time gap (ms) between samples before the buffer is considered stale.
 * After a pause longer than this, previous samples no longer represent the
 * current scroll gesture — we reset and start measuring fresh.
 * Set below the idle timeout (150ms) so stale detection triggers before idle.
 */
const STALE_GAP_MS = 100;

interface VelocitySample {
  position: number;
  time: number;
}

interface VelocityTracker {
  velocity: number;
  lastPosition: number;
  lastTime: number;
  /** Circular buffer of samples (pre-allocated, reused) */
  samples: VelocitySample[];
  /** Current write index in circular buffer */
  sampleIndex: number;
  /** Number of valid samples (0 to VELOCITY_SAMPLE_COUNT) */
  sampleCount: number;
}

const createVelocityTracker = (initialPosition = 0): VelocityTracker => {
  // Pre-allocate sample array to avoid allocation during scrolling
  const samples: VelocitySample[] = new Array(VELOCITY_SAMPLE_COUNT);
  for (let i = 0; i < VELOCITY_SAMPLE_COUNT; i++) {
    samples[i] = { position: 0, time: 0 };
  }

  return {
    velocity: 0,
    lastPosition: initialPosition,
    lastTime: performance.now(),
    samples,
    sampleIndex: 0,
    sampleCount: 0,
  };
};

const updateVelocityTracker = (
  tracker: VelocityTracker,
  newPosition: number,
): VelocityTracker => {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;

  if (timeDelta === 0) return tracker;

  // Stale gap detection: if too much time has passed since the last sample,
  // the previous measurements belong to a different scroll gesture.
  // Reset the buffer and record this position as the new baseline.
  // Velocity stays at 0 (unreliable) until MIN_RELIABLE_SAMPLES accumulate.
  if (timeDelta > STALE_GAP_MS) {
    tracker.sampleCount = 0;
    tracker.sampleIndex = 0;
    tracker.velocity = 0;
    // Record baseline — first real velocity will be computed on the next update
    const baseline = tracker.samples[0]!;
    baseline.position = newPosition;
    baseline.time = now;
    tracker.sampleIndex = 1;
    tracker.sampleCount = 1;
    tracker.lastPosition = newPosition;
    tracker.lastTime = now;
    return tracker;
  }

  // Write to current slot in circular buffer (no allocation)
  const currentSample = tracker.samples[tracker.sampleIndex]!;
  currentSample.position = newPosition;
  currentSample.time = now;

  // Advance index (wrap around)
  tracker.sampleIndex = (tracker.sampleIndex + 1) % VELOCITY_SAMPLE_COUNT;
  tracker.sampleCount = Math.min(
    tracker.sampleCount + 1,
    VELOCITY_SAMPLE_COUNT,
  );

  // Calculate average velocity from samples (only when we have enough data)
  if (tracker.sampleCount >= 2) {
    const oldestIndex =
      (tracker.sampleIndex - tracker.sampleCount + VELOCITY_SAMPLE_COUNT) %
      VELOCITY_SAMPLE_COUNT;
    const oldest = tracker.samples[oldestIndex]!;
    const totalDistance = newPosition - oldest.position;
    const totalTime = now - oldest.time;
    tracker.velocity = totalTime > 0 ? totalDistance / totalTime : 0;
  }
  // sampleCount < 2: keep velocity at 0 (not enough data yet)

  // Update position/time baseline (mutate in place to avoid allocation)
  tracker.lastPosition = newPosition;
  tracker.lastTime = now;

  return tracker;
};

/** Check if the velocity tracker has accumulated enough samples for reliable readings */
const isVelocityTrackerReliable = (tracker: VelocityTracker): boolean =>
  tracker.sampleCount >= MIN_RELIABLE_SAMPLES;

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
  const {
    sensitivity = 1,
    smoothing = false,
    idleTimeout: idleMs = 150,
    onScroll,
    onIdle,
    scrollElement,
  } = config;

  const windowMode = !!scrollElement;

  // State
  let scrollPosition = 0;
  let maxScroll = 0;
  let containerHeight = windowMode ? window.innerHeight : viewport.clientHeight;
  let compressed = config.compressed ?? false;
  let compression = config.compression;
  let velocityTracker = createVelocityTracker();
  let isScrolling = false;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;

  // =============================================================================
  // Native Scroll Handling
  // =============================================================================

  const handleNativeScrollRaw = (): void => {
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

  // M1: RAF-throttle native scroll to guarantee at most one processing per frame
  const handleNativeScroll = rafThrottle(handleNativeScrollRaw);

  // =============================================================================
  // Window Scroll Handling
  // =============================================================================

  const handleWindowScrollRaw = (): void => {
    // Compute list-relative scroll position from the viewport's bounding rect.
    // When the list's top edge is at the window's top, rect.top = 0, scrollTop = 0.
    // When the list has scrolled 500px past, rect.top = -500, scrollTop = 500.
    const rect = viewport.getBoundingClientRect();
    const newPosition = Math.max(0, -rect.top);
    const direction: ScrollDirection =
      newPosition >= scrollPosition ? "down" : "up";

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
  };

  const handleWindowScroll = rafThrottle(handleWindowScrollRaw);

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
    }, idleMs);
  };

  // =============================================================================
  // Mode Switching
  // =============================================================================

  const enableCompression = (newCompression: CompressionState): void => {
    if (compressed) return;

    compressed = true;
    compression = newCompression;
    maxScroll = newCompression.virtualHeight - containerHeight;

    // In window mode, compression is purely mathematical — the content div
    // height is set to the virtual height by vlist.ts, and the browser scrolls
    // natively. No overflow changes or wheel interception needed.
    if (windowMode) return;

    // Remove native scroll listener and cancel pending RAF
    handleNativeScroll.cancel();
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

    // In window mode, nothing to revert — compression was purely mathematical
    if (windowMode) {
      compression = undefined;
      return;
    }

    // Remove wheel listener
    viewport.removeEventListener("wheel", handleWheel);

    // Restore native scrolling
    viewport.style.overflow = "auto";

    // Add native scroll listener
    viewport.addEventListener("scroll", handleNativeScroll, { passive: true });

    // Restore scroll position
    if (compression && scrollPosition > 0) {
      const ratio = scrollPosition / maxScroll;
      viewport.scrollTop = ratio * (compression.actualHeight - containerHeight);
    }

    compression = undefined;
  };

  // =============================================================================
  // Public API
  // =============================================================================

  const getScrollTop = (): number => {
    // In window mode, scrollPosition is always the source of truth
    // (viewport.scrollTop is 0 because overflow is visible).
    // In compressed mode, scrollPosition is manually tracked.
    // In native container mode, read from the DOM.
    return windowMode || compressed ? scrollPosition : viewport.scrollTop;
  };

  const scrollTo = (position: number, smooth = false): void => {
    const clampedPosition = Math.max(
      0,
      Math.min(position, maxScroll || Infinity),
    );

    if (windowMode) {
      // Scroll the window so the desired list position is at the top of the viewport.
      // listDocumentTop = the list's absolute position in the document.
      const rect = viewport.getBoundingClientRect();
      const listDocumentTop = rect.top + window.scrollY;
      window.scrollTo({
        top: listDocumentTop + clampedPosition,
        behavior: smooth ? "smooth" : "auto",
      });
      // The window scroll event will fire and update scrollPosition via handleWindowScroll
    } else if (compressed) {
      if (clampedPosition === scrollPosition) return;

      const previousPosition = scrollPosition;
      const direction: ScrollDirection =
        clampedPosition >= previousPosition ? "down" : "up";

      velocityTracker = updateVelocityTracker(velocityTracker, clampedPosition);
      scrollPosition = clampedPosition;

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

      scheduleIdleCheck();
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
    // In window mode or compressed mode, use maxScroll (explicitly tracked).
    // In native container mode, derive from the viewport's scroll geometry.
    const max =
      windowMode || compressed
        ? maxScroll
        : viewport.scrollHeight - viewport.clientHeight;
    return scrollTop >= max - threshold;
  };

  const getScrollPercentage = (): number => {
    const scrollTop = getScrollTop();
    const max =
      windowMode || compressed
        ? maxScroll
        : viewport.scrollHeight - viewport.clientHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, scrollTop / max));
  };

  const updateConfig = (newConfig: Partial<ScrollControllerConfig>): void => {
    if (newConfig.compression) {
      compression = newConfig.compression;
      maxScroll = compression.virtualHeight - containerHeight;
    }
  };

  const isCompressedMode = (): boolean => compressed;

  const getVelocityValue = (): number => Math.abs(velocityTracker.velocity);

  const getIsTracking = (): boolean =>
    isVelocityTrackerReliable(velocityTracker);

  const getIsScrolling = (): boolean => isScrolling;

  const getIsWindowMode = (): boolean => windowMode;

  const updateContainerHeightFn = (height: number): void => {
    containerHeight = height;
    // Recompute maxScroll if we have compression or are in window mode
    if (compression) {
      maxScroll = compression.virtualHeight - containerHeight;
    } else if (windowMode) {
      // In window mode without compression, maxScroll is derived from
      // the content div height. vlist.ts calls updateConfig with compression
      // when totalHeight changes, so this path handles the non-compressed case.
      // We can't compute it here without knowing totalHeight, so leave it
      // and let updateConfig handle it when compression state is updated.
    }
  };

  const destroy = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    if (windowMode) {
      handleWindowScroll.cancel();
      window.removeEventListener("scroll", handleWindowScroll);
    } else {
      handleNativeScroll.cancel();
      viewport.removeEventListener("scroll", handleNativeScroll);
      viewport.removeEventListener("wheel", handleWheel);
    }
  };

  // =============================================================================
  // Initialization
  // =============================================================================

  if (windowMode) {
    // Window scroll mode — listen to window, don't manage viewport overflow
    if (compressed && compression) {
      maxScroll = compression.virtualHeight - containerHeight;
    }
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
  } else if (compressed && compression) {
    // Start in compressed mode
    maxScroll = compression.virtualHeight - containerHeight;
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
    isTracking: getIsTracking,
    isScrolling: getIsScrolling,
    updateConfig,
    enableCompression,
    disableCompression,
    isCompressed: isCompressedMode,
    isWindowMode: getIsWindowMode,
    updateContainerHeight: updateContainerHeightFn,
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
