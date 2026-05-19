// src/builder/velocity.ts
/**
 * vlist/builder — Velocity Tracking
 * Lightweight 2-sample velocity tracker for scroll momentum detection.
 */

export const MIN_RELIABLE_SAMPLES = 2;

/** Create a velocity tracker. */
export const createVelocityTracker = (_initialPosition = 0): {
  velocity: number;
  sampleCount: number;
} => ({
  velocity: 0,
  sampleCount: 0,
});

/** Update velocity from new scroll position. Mutates tracker in place. */
export const updateVelocityTracker = (
  tracker: { velocity: number; sampleCount: number; _lp?: number; _lt?: number },
  newPosition: number,
): { velocity: number; sampleCount: number; _lp?: number; _lt?: number } => {
  const now = performance.now();
  const lastTime = tracker._lt ?? now;
  const lastPos = tracker._lp ?? newPosition;
  const dt = now - lastTime;

  tracker._lp = newPosition;
  tracker._lt = now;

  // Zero time delta — record position but can't compute velocity
  if (dt === 0) {
    tracker.sampleCount = Math.min(tracker.sampleCount + 1, 5);
    return tracker;
  }

  // Stale gap — reset
  if (dt > 100) {
    tracker.velocity = 0;
    tracker.sampleCount = 1;
    return tracker;
  }

  tracker.velocity = Math.abs(newPosition - lastPos) / dt;
  tracker.sampleCount = Math.min(tracker.sampleCount + 1, 5);
  return tracker;
};
