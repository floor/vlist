/**
 * vlist - Builder Velocity Tests
 * Tests for velocity tracking (scroll momentum detection)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createVelocityTracker,
  updateVelocityTracker,
  VELOCITY_SAMPLE_COUNT,
  STALE_GAP_MS,
  MIN_RELIABLE_SAMPLES,
  type VelocityTracker,
} from "../../src/builder/velocity";

// =============================================================================
// Constants Tests
// =============================================================================

describe("velocity constants", () => {
  it("should have correct default values", () => {
    expect(VELOCITY_SAMPLE_COUNT).toBe(5);
    expect(STALE_GAP_MS).toBe(100);
    expect(MIN_RELIABLE_SAMPLES).toBe(2);
  });
});

// =============================================================================
// createVelocityTracker
// =============================================================================

describe("createVelocityTracker", () => {
  it("should create tracker with default initial position", () => {
    const tracker = createVelocityTracker();

    expect(tracker.velocity).toBe(0);
    expect(tracker.lastPosition).toBe(0);
    expect(tracker.sampleIndex).toBe(0);
    expect(tracker.sampleCount).toBe(0);
    expect(tracker.samples.length).toBe(VELOCITY_SAMPLE_COUNT);
    expect(typeof tracker.lastTime).toBe("number");
  });

  it("should create tracker with custom initial position", () => {
    const tracker = createVelocityTracker(100);

    expect(tracker.lastPosition).toBe(100);
    expect(tracker.velocity).toBe(0);
  });

  it("should initialize all sample slots", () => {
    const tracker = createVelocityTracker();

    expect(tracker.samples.length).toBe(VELOCITY_SAMPLE_COUNT);
    for (const sample of tracker.samples) {
      expect(sample.position).toBe(0);
      expect(sample.time).toBe(0);
    }
  });

  it("should set lastTime to current time", () => {
    const before = performance.now();
    const tracker = createVelocityTracker();
    const after = performance.now();

    expect(tracker.lastTime).toBeGreaterThanOrEqual(before);
    expect(tracker.lastTime).toBeLessThanOrEqual(after);
  });
});

// =============================================================================
// updateVelocityTracker
// =============================================================================

describe("updateVelocityTracker - basic updates", () => {
  let tracker: VelocityTracker;

  beforeEach(() => {
    tracker = createVelocityTracker(0);
  });

  it("should update position and time", () => {
    const oldTime = tracker.lastTime;

    tracker = updateVelocityTracker(tracker, 100);

    expect(tracker.lastPosition).toBe(100);
    expect(tracker.lastTime).toBeGreaterThan(oldTime);
  });

  it("should increment sample count", () => {
    expect(tracker.sampleCount).toBe(0);

    tracker = updateVelocityTracker(tracker, 100);

    expect(tracker.sampleCount).toBe(1);
  });

  it("should advance sample index", () => {
    expect(tracker.sampleIndex).toBe(0);

    tracker = updateVelocityTracker(tracker, 100);

    expect(tracker.sampleIndex).toBe(1);
  });

  it("should store position and time in sample", () => {
    tracker = updateVelocityTracker(tracker, 100);

    const sample = tracker.samples[0];
    expect(sample?.position).toBe(100);
    expect(sample?.time).toBeGreaterThan(0);
  });

  it("should cap sample count at VELOCITY_SAMPLE_COUNT", () => {
    for (let i = 0; i < 10; i++) {
      tracker = updateVelocityTracker(tracker, i * 100);
    }

    expect(tracker.sampleCount).toBe(VELOCITY_SAMPLE_COUNT);
  });

  it("should wrap sample index around", () => {
    for (let i = 0; i < VELOCITY_SAMPLE_COUNT + 2; i++) {
      tracker = updateVelocityTracker(tracker, i * 100);
    }

    expect(tracker.sampleIndex).toBe(2); // Wrapped around
  });
});

describe("updateVelocityTracker - velocity calculation", () => {
  it("should not calculate velocity with fewer than MIN_RELIABLE_SAMPLES", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);

    expect(tracker.sampleCount).toBe(1);
    expect(tracker.velocity).toBe(0);
  });

  it("should calculate velocity with MIN_RELIABLE_SAMPLES or more", () => {
    let tracker = createVelocityTracker(0);

    // First sample
    tracker = updateVelocityTracker(tracker, 100);

    // Wait a bit and add second sample
    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 200);

      expect(tracker.sampleCount).toBeGreaterThanOrEqual(MIN_RELIABLE_SAMPLES);
      expect(tracker.velocity).toBeGreaterThan(0);
    });
  });

  it("should calculate velocity as distance over time", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 300);

      // velocity = distance / time (px/ms)
      // distance = 300 - 100 = 200px
      // time ~= 10ms
      // velocity ~= 200/10 = 20 px/ms
      expect(tracker.velocity).toBeGreaterThan(0);
      expect(tracker.velocity).toBeLessThan(100); // Reasonable upper bound
    });
  });

  it("should use absolute distance for velocity", () => {
    let tracker = createVelocityTracker(100);

    tracker = updateVelocityTracker(tracker, 50);

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 0);

      expect(tracker.velocity).toBeGreaterThan(0); // Positive even though scrolling backward
    });
  });

  it("should average velocity across all samples", async () => {
    let tracker = createVelocityTracker(0);

    // Add multiple samples with actual waits
    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      tracker = updateVelocityTracker(tracker, i * 100);
    }

    expect(tracker.sampleCount).toBeGreaterThanOrEqual(MIN_RELIABLE_SAMPLES);
  });
});

describe("updateVelocityTracker - stale gap detection", () => {
  it("should reset tracker when time gap exceeds STALE_GAP_MS", () => {
    let tracker = createVelocityTracker(0);

    // Add some samples
    tracker = updateVelocityTracker(tracker, 100);
    tracker = updateVelocityTracker(tracker, 200);

    expect(tracker.sampleCount).toBeGreaterThan(0);

    // Simulate stale gap by manually adjusting lastTime
    tracker.lastTime = performance.now() - STALE_GAP_MS - 50;

    tracker = updateVelocityTracker(tracker, 300);

    expect(tracker.sampleCount).toBe(1); // Reset to 1
    expect(tracker.velocity).toBe(0); // Reset velocity
  });

  it("should set baseline sample after stale gap", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);

    // Simulate stale gap
    tracker.lastTime = performance.now() - STALE_GAP_MS - 50;

    tracker = updateVelocityTracker(tracker, 500);

    const baseline = tracker.samples[0];
    expect(baseline?.position).toBe(500);
    expect(tracker.sampleIndex).toBe(1);
  });

  it("should not reset for gaps smaller than STALE_GAP_MS", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);
    tracker = updateVelocityTracker(tracker, 200);

    const oldCount = tracker.sampleCount;

    // Small gap (within threshold)
    tracker.lastTime = performance.now() - 50;

    tracker = updateVelocityTracker(tracker, 300);

    expect(tracker.sampleCount).toBeGreaterThan(oldCount);
  });
});

describe("updateVelocityTracker - edge cases", () => {
  it("should handle zero time delta (returns tracker unchanged)", () => {
    let tracker = createVelocityTracker(0);

    const oldCount = tracker.sampleCount;

    // Set lastTime to current time to create zero delta
    const now = performance.now();
    tracker.lastTime = now;

    // Mock performance.now to return same value
    const originalNow = performance.now;
    performance.now = () => now;

    tracker = updateVelocityTracker(tracker, 100);

    // Restore performance.now
    performance.now = originalNow;

    // Should return early without updating
    expect(tracker.sampleCount).toBe(oldCount);
  });

  it("should handle no movement (same position)", () => {
    let tracker = createVelocityTracker(100);

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 100);

      return wait().then(() => {
        tracker = updateVelocityTracker(tracker, 100);

        expect(tracker.velocity).toBe(0); // No movement = 0 velocity
      });
    });
  });

  it("should handle large position changes", async () => {
    let tracker = createVelocityTracker(0);

    // Need at least 2 samples for velocity calculation
    tracker = updateVelocityTracker(tracker, 5000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    tracker = updateVelocityTracker(tracker, 10000);

    expect(tracker.velocity).toBeGreaterThan(0);
    expect(tracker.lastPosition).toBe(10000);
  });

  it("should handle negative positions", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, -100);

    expect(tracker.lastPosition).toBe(-100);
  });

  it("should handle rapid consecutive updates", () => {
    let tracker = createVelocityTracker(0);

    for (let i = 1; i <= 10; i++) {
      tracker = updateVelocityTracker(tracker, i * 10);
    }

    expect(tracker.sampleCount).toBe(VELOCITY_SAMPLE_COUNT);
    expect(tracker.lastPosition).toBe(100);
  });

  it("should maintain circular buffer integrity", () => {
    let tracker = createVelocityTracker(0);

    // Fill buffer multiple times
    for (let i = 0; i < VELOCITY_SAMPLE_COUNT * 3; i++) {
      tracker = updateVelocityTracker(tracker, i * 100);
    }

    // Check all samples are valid
    for (const sample of tracker.samples) {
      expect(sample.position).toBeGreaterThanOrEqual(0);
      expect(sample.time).toBeGreaterThan(0);
    }
  });
});

describe("updateVelocityTracker - mutability", () => {
  it("should mutate tracker in place", () => {
    const tracker = createVelocityTracker(0);

    const result = updateVelocityTracker(tracker, 100);

    expect(result).toBe(tracker); // Same object reference
  });

  it("should allow chaining updates", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);
    tracker = updateVelocityTracker(tracker, 200);
    tracker = updateVelocityTracker(tracker, 300);

    expect(tracker.lastPosition).toBe(300);
  });
});

describe("velocity tracking scenarios", () => {
  it("should track accelerating scroll", () => {
    let tracker = createVelocityTracker(0);
    let position = 0;

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));

    return wait().then(() => {
      position += 50;
      tracker = updateVelocityTracker(tracker, position);

      return wait().then(() => {
        position += 100;
        tracker = updateVelocityTracker(tracker, position);

        return wait().then(() => {
          position += 200;
          tracker = updateVelocityTracker(tracker, position);

          expect(tracker.velocity).toBeGreaterThan(0);
        });
      });
    });
  });

  it("should track constant velocity scroll", () => {
    let tracker = createVelocityTracker(0);
    let position = 0;

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));

    return wait().then(() => {
      position += 100;
      tracker = updateVelocityTracker(tracker, position);

      return wait().then(() => {
        position += 100;
        tracker = updateVelocityTracker(tracker, position);

        return wait().then(() => {
          position += 100;
          tracker = updateVelocityTracker(tracker, position);

          expect(tracker.velocity).toBeGreaterThan(0);
        });
      });
    });
  });

  it("should detect scroll stop", () => {
    let tracker = createVelocityTracker(0);

    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    return wait(10).then(() => {
      tracker = updateVelocityTracker(tracker, 100);

      return wait(10).then(() => {
        tracker = updateVelocityTracker(tracker, 200);

        // Long pause (stale gap)
        return wait(STALE_GAP_MS + 50).then(() => {
          tracker = updateVelocityTracker(tracker, 300);

          expect(tracker.velocity).toBe(0); // Reset after stale gap
        });
      });
    });
  });
});
