// src/builder/velocity.ts
/**
 * vlist/builder — Velocity Tracking
 * Circular-buffer velocity tracker for scroll momentum detection.
 */

// =============================================================================
// Constants
// =============================================================================

export const VELOCITY_SAMPLE_COUNT = 5;
export const STALE_GAP_MS = 100;
export const MIN_RELIABLE_SAMPLES = 2;

// =============================================================================
// Types
// =============================================================================

export interface VelocitySample {
  position: number;
  time: number;
}

export interface VelocityTracker {
  velocity: number;
  lastPosition: number;
  lastTime: number;
  samples: VelocitySample[];
  sampleIndex: number;
  sampleCount: number;
}

// =============================================================================
// Factory
// =============================================================================

export const createVelocityTracker = (initialPosition = 0): VelocityTracker => {
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

// =============================================================================
// Update
// =============================================================================

export const updateVelocityTracker = (
  tracker: VelocityTracker,
  newPosition: number,
): VelocityTracker => {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;

  if (timeDelta === 0) return tracker;

  // Stale gap detection - reset if too much time passed
  if (timeDelta > STALE_GAP_MS) {
    tracker.sampleCount = 0;
    tracker.sampleIndex = 0;
    tracker.velocity = 0;
    const baseline = tracker.samples[0]!;
    baseline.position = newPosition;
    baseline.time = now;
    tracker.sampleIndex = 1;
    tracker.sampleCount = 1;
    tracker.lastPosition = newPosition;
    tracker.lastTime = now;
    return tracker;
  }

  // Write to current slot in circular buffer
  const currentSample = tracker.samples[tracker.sampleIndex]!;
  currentSample.position = newPosition;
  currentSample.time = now;

  // Advance index (wrap around)
  tracker.sampleIndex = (tracker.sampleIndex + 1) % VELOCITY_SAMPLE_COUNT;
  tracker.sampleCount = Math.min(
    tracker.sampleCount + 1,
    VELOCITY_SAMPLE_COUNT,
  );

  // Calculate average velocity from samples
  if (tracker.sampleCount >= MIN_RELIABLE_SAMPLES) {
    const oldestIndex =
      (tracker.sampleIndex - tracker.sampleCount + VELOCITY_SAMPLE_COUNT) %
      VELOCITY_SAMPLE_COUNT;
    const oldest = tracker.samples[oldestIndex]!;
    const totalDistance = newPosition - oldest.position;
    const totalTime = now - oldest.time;
    tracker.velocity = totalTime > 0 ? Math.abs(totalDistance) / totalTime : 0;
  }

  tracker.lastPosition = newPosition;
  tracker.lastTime = now;

  return tracker;
};
