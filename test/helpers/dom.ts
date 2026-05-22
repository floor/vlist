/**
 * vlist/test/helpers — Shared DOM Setup (happy-dom)
 *
 * Uses happy-dom's GlobalRegistrator for full DOM API support including
 * querySelector, scrollTo, ResizeObserver, sessionStorage, etc.
 *
 * Each test file runs in its own Bun worker, so GlobalRegistrator is safe.
 *
 * Usage:
 *   import { setupDOM, teardownDOM } from "../helpers/dom";
 *   beforeAll(() => setupDOM());
 *   afterAll(() => teardownDOM());
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// =============================================================================
// MockResizeObserver
// =============================================================================

export interface MockResizeObserverInstance extends ResizeObserver {
  readonly callback: ResizeObserverCallback;
}

/**
 * Create a MockResizeObserver class.
 *
 * By default, `observe()` immediately fires the callback with the given
 * `width` and `height`.  Pass `{ immediate: false }` to suppress automatic
 * invocation (useful when you want to trigger resize manually).
 */
export const createMockResizeObserver = (
  opts: { width?: number; height?: number; immediate?: boolean } = {},
) => {
  const { width = 300, height = 500, immediate = true } = opts;

  return class MockResizeObserver implements ResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      if (!immediate) return;
      this.callback(
        [
          {
            target,
            contentRect: {
              width,
              height,
              top: 0,
              left: 0,
              bottom: height,
              right: width,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            } as DOMRectReadOnly,
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
  } as unknown as typeof ResizeObserver;
};

// =============================================================================
// Fake Timers
// =============================================================================

interface FakeTimerHandle {
  id: number;
  fn: () => void;
  time: number;
  interval: number;
}

export function useFakeTimers(): {
  tick: (ms: number) => void;
  restore: () => void;
} {
  const timers: FakeTimerHandle[] = [];
  let now = 0;
  let nextId = 1;

  const origSetTimeout = global.setTimeout;
  const origClearTimeout = global.clearTimeout;
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;

  global.setTimeout = ((fn: () => void, delay = 0): number => {
    const id = nextId++;
    timers.push({ id, fn, time: now + delay, interval: 0 });
    return id;
  }) as any;

  global.clearTimeout = ((id: number): void => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx !== -1) timers.splice(idx, 1);
  }) as any;

  global.setInterval = ((fn: () => void, delay: number): number => {
    const id = nextId++;
    timers.push({ id, fn, time: now + delay, interval: delay });
    return id;
  }) as any;

  global.clearInterval = ((id: number): void => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx !== -1) timers.splice(idx, 1);
  }) as any;

  const tick = (ms: number): void => {
    const target = now + ms;
    while (true) {
      let earliest: FakeTimerHandle | undefined;
      for (const t of timers) {
        if (t.time <= target && (!earliest || t.time < earliest.time))
          earliest = t;
      }
      if (!earliest) break;
      now = earliest.time;
      if (earliest.interval > 0) {
        earliest.time = now + earliest.interval;
        earliest.fn();
      } else {
        const idx = timers.indexOf(earliest);
        timers.splice(idx, 1);
        earliest.fn();
      }
    }
    now = target;
  };

  const restore = (): void => {
    global.setTimeout = origSetTimeout;
    global.clearTimeout = origClearTimeout;
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
  };

  return { tick, restore };
}

// =============================================================================
// Setup / Teardown
// =============================================================================

export interface SetupDOMOptions {
  /** Width reported by MockResizeObserver (default 300) */
  width?: number;
  /** Height reported by MockResizeObserver (default 500) */
  height?: number;
  /** Whether MockResizeObserver fires immediately on observe (default true) */
  immediateResize?: boolean;
}

let registered = false;
let origRAF: typeof globalThis.requestAnimationFrame | undefined;
let origCAF: typeof globalThis.cancelAnimationFrame | undefined;

/**
 * Bootstrap a happy-dom environment via GlobalRegistrator.
 *
 * Provides all standard DOM APIs: document, window, HTMLElement, Element,
 * MouseEvent, KeyboardEvent, ResizeObserver, requestAnimationFrame,
 * cancelAnimationFrame, scrollTo, sessionStorage, queueMicrotask.
 *
 * Call `teardownDOM()` in `afterAll` to unregister.
 */
export const setupDOM = (opts: SetupDOMOptions = {}): void => {
  const { width = 300, height = 500, immediateResize = true } = opts;

  if (!registered) {
    GlobalRegistrator.register();
    registered = true;
  }

  // Override ResizeObserver with our controllable mock
  global.ResizeObserver = createMockResizeObserver({
    width,
    height,
    immediate: immediateResize,
  });

  // Override rAF with setTimeout-based version for test determinism
  origRAF = global.requestAnimationFrame;
  origCAF = global.cancelAnimationFrame;
  global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  global.cancelAnimationFrame = (id: number): void => clearTimeout(id);
};

/**
 * Unregister happy-dom globals.
 */
export const teardownDOM = (): void => {
  if (origRAF) global.requestAnimationFrame = origRAF;
  if (origCAF) global.cancelAnimationFrame = origCAF;

  if (registered) {
    GlobalRegistrator.unregister();
    registered = false;
  }
};
