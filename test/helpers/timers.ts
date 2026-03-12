/**
 * vlist/test/helpers — Shared Timer Utilities
 *
 * Centralises timer-related helpers used across test files:
 * `flushMicrotasks()`, `flushTimers()`, `advanceTimers()`.
 *
 * Usage:
 *   import { flushMicrotasks, flushTimers, advanceTimers } from "../helpers/timers";
 */

// =============================================================================
// Microtask flushing
// =============================================================================

/**
 * Flush all pending microtasks (Promise callbacks, queueMicrotask).
 *
 * Bun's test runner doesn't advance the microtask queue synchronously,
 * so we schedule a macrotask and await it — the microtask checkpoint
 * runs before the macrotask resolves.
 */
export const flushMicrotasks = (): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, 0));
};

// =============================================================================
// Timer flushing
// =============================================================================

/**
 * Flush all pending timers (setTimeout / setInterval) by awaiting
 * a short delay.  Use `ms` to control how long to wait (default 0,
 * which waits for the next macrotask tick).
 *
 * @param ms  Milliseconds to wait (default 0).
 */
export const flushTimers = (ms: number = 0): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Advance timers by a specific duration.
 *
 * This is a convenience alias for `flushTimers(ms)` that makes test
 * intent clearer when you need a specific amount of time to pass
 * (e.g. debounce timeouts, animation durations).
 *
 * @param ms  Milliseconds to advance.
 */
export const advanceTimers = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// =============================================================================
// requestAnimationFrame helpers
// =============================================================================

/**
 * Flush one pending `requestAnimationFrame` callback.
 *
 * In test environments, `requestAnimationFrame` is typically shimmed
 * via `setTimeout(..., 0)`.  This helper awaits a single macrotask
 * tick so the RAF callback executes.
 */
export const flushRAF = (): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Flush multiple `requestAnimationFrame` callbacks.
 *
 * @param count  Number of RAF frames to flush (default 1).
 */
export const flushRAFs = async (count: number = 1): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await flushRAF();
  }
};