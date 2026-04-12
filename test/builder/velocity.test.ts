/**
 * vlist - Builder Velocity Tests
 * Tests for velocity tracking (scroll momentum detection)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createVelocityTracker,
  updateVelocityTracker,
  MIN_RELIABLE_SAMPLES,
} from "../../src/builder/velocity";

// =============================================================================
// Constants Tests
// =============================================================================

describe("velocity constants", () => {
  it("should have correct default values", () => {
    expect(MIN_RELIABLE_SAMPLES).toBe(2);
  });
});

// =============================================================================
// createVelocityTracker
// =============================================================================

describe("createVelocityTracker", () => {
  it("should create tracker with zero velocity", () => {
    const tracker = createVelocityTracker();
    expect(tracker.velocity).toBe(0);
    expect(tracker.sampleCount).toBe(0);
  });

  it("should accept an initial position argument", () => {
    const tracker = createVelocityTracker(100);
    expect(tracker.velocity).toBe(0);
  });
});

// =============================================================================
// updateVelocityTracker
// =============================================================================

describe("updateVelocityTracker - basic updates", () => {
  let tracker: ReturnType<typeof createVelocityTracker>;

  beforeEach(() => {
    tracker = createVelocityTracker(0);
  });

  it("should increment sample count", () => {
    expect(tracker.sampleCount).toBe(0);
    tracker = updateVelocityTracker(tracker, 100);
    expect(tracker.sampleCount).toBeGreaterThanOrEqual(1);
  });

  it("should cap sample count", () => {
    for (let i = 0; i < 10; i++) {
      tracker = updateVelocityTracker(tracker, i * 100);
    }
    expect(tracker.sampleCount).toBeLessThanOrEqual(5);
  });
});

describe("updateVelocityTracker - velocity calculation", () => {
  it("should calculate velocity with MIN_RELIABLE_SAMPLES or more", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);

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

      expect(tracker.velocity).toBeGreaterThan(0);
      expect(tracker.velocity).toBeLessThan(100);
    });
  });

  it("should use absolute distance for velocity", () => {
    let tracker = createVelocityTracker(100);

    tracker = updateVelocityTracker(tracker, 50);

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 0);
      expect(tracker.velocity).toBeGreaterThan(0);
    });
  });

  it("should average velocity across samples", async () => {
    let tracker = createVelocityTracker(0);

    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      tracker = updateVelocityTracker(tracker, i * 100);
    }

    expect(tracker.sampleCount).toBeGreaterThanOrEqual(MIN_RELIABLE_SAMPLES);
  });
});

describe("updateVelocityTracker - stale gap detection", () => {
  it("should reset tracker when time gap exceeds threshold", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);
    tracker = updateVelocityTracker(tracker, 200);

    expect(tracker.sampleCount).toBeGreaterThan(0);

    // Simulate stale gap by adjusting internal lastTime
    (tracker as any)._lt = performance.now() - 150;

    tracker = updateVelocityTracker(tracker, 300);

    expect(tracker.sampleCount).toBe(1);
    expect(tracker.velocity).toBe(0);
  });

  it("should not reset for gaps smaller than threshold", () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 100);
    tracker = updateVelocityTracker(tracker, 200);

    const oldCount = tracker.sampleCount;

    (tracker as any)._lt = performance.now() - 50;

    tracker = updateVelocityTracker(tracker, 300);

    expect(tracker.sampleCount).toBeGreaterThan(oldCount);
  });
});

describe("updateVelocityTracker - edge cases", () => {
  it("should handle zero time delta without computing velocity", () => {
    let tracker = createVelocityTracker(0);

    const now = performance.now();
    (tracker as any)._lt = now;

    const originalNow = performance.now;
    performance.now = () => now;

    tracker = updateVelocityTracker(tracker, 100);

    performance.now = originalNow;

    // Position recorded, but velocity stays 0 (can't divide by 0)
    expect(tracker.velocity).toBe(0);
  });

  it("should handle no movement (same position)", () => {
    let tracker = createVelocityTracker(100);

    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    return wait().then(() => {
      tracker = updateVelocityTracker(tracker, 100);

      return wait().then(() => {
        tracker = updateVelocityTracker(tracker, 100);
        expect(tracker.velocity).toBe(0);
      });
    });
  });

  it("should handle large position changes", async () => {
    let tracker = createVelocityTracker(0);

    tracker = updateVelocityTracker(tracker, 5000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    tracker = updateVelocityTracker(tracker, 10000);

    expect(tracker.velocity).toBeGreaterThan(0);
  });

  it("should handle rapid consecutive updates", () => {
    let tracker = createVelocityTracker(0);

    for (let i = 1; i <= 10; i++) {
      tracker = updateVelocityTracker(tracker, i * 10);
    }

    expect(tracker.sampleCount).toBeLessThanOrEqual(5);
  });
});

describe("updateVelocityTracker - mutability", () => {
  it("should mutate tracker in place", () => {
    const tracker = createVelocityTracker(0);
    const result = updateVelocityTracker(tracker, 100);
    expect(result).toBe(tracker);
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

  it("should detect scroll stop via stale gap", () => {
    let tracker = createVelocityTracker(0);

    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    return wait(10).then(() => {
      tracker = updateVelocityTracker(tracker, 100);

      return wait(10).then(() => {
        tracker = updateVelocityTracker(tracker, 200);

        return wait(150).then(() => {
          tracker = updateVelocityTracker(tracker, 300);
          expect(tracker.velocity).toBe(0);
        });
      });
    });
  });
});
