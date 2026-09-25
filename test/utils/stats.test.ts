/**
 * vlist - Stats Utility Tests
 * Tests for scroll statistics (velocity, item count, progress)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createStats, type Stats, type StatsConfig } from "../../src/utils/stats";

// =============================================================================
// Helpers
// =============================================================================

function makeConfig(overrides: Partial<StatsConfig> = {}): StatsConfig {
  return {
    getScrollPosition: () => 0,
    getTotal: () => 100,
    getItemSize: () => 50,
    getContainerSize: () => 500,
    ...overrides,
  };
}

// =============================================================================
// createStats — initial state
// =============================================================================

describe("createStats — initial state", () => {
  it("should return an object with getState and onVelocity", () => {
    const stats = createStats(makeConfig());

    expect(typeof stats.getState).toBe("function");
    expect(typeof stats.onVelocity).toBe("function");
  });

  it("should have zero velocity and velocityAvg initially", () => {
    const stats = createStats(makeConfig());
    const state = stats.getState();

    expect(state.velocity).toBe(0);
    expect(state.velocityAvg).toBe(0);
  });

  it("should report total from config", () => {
    const stats = createStats(makeConfig({ getTotal: () => 42 }));

    expect(stats.getState().total).toBe(42);
  });

  it("should reflect config changes without recreation", () => {
    let total = 10;
    const stats = createStats(makeConfig({ getTotal: () => total }));

    expect(stats.getState().total).toBe(10);

    total = 200;
    expect(stats.getState().total).toBe(200);
  });
});

// =============================================================================
// onVelocity — velocity tracking
// =============================================================================

describe("onVelocity", () => {
  let stats: Stats;

  beforeEach(() => {
    stats = createStats(makeConfig());
  });

  it("should update current velocity", () => {
    stats.onVelocity(5);

    expect(stats.getState().velocity).toBe(5);
  });

  it("should overwrite previous velocity", () => {
    stats.onVelocity(5);
    stats.onVelocity(10);

    expect(stats.getState().velocity).toBe(10);
  });

  it("should accumulate valid samples into velocityAvg", () => {
    stats.onVelocity(1);
    stats.onVelocity(3);

    // avg = (1 + 3) / 2 = 2
    expect(stats.getState().velocityAvg).toBe(2);
  });

  it("should exclude samples at or below MIN_VELOCITY (0.1)", () => {
    stats.onVelocity(0.1); // excluded (not > 0.1)
    stats.onVelocity(0.05); // excluded
    stats.onVelocity(2);

    // Only 2 is counted → avg = 2 / 1 = 2
    expect(stats.getState().velocityAvg).toBe(2);
  });

  it("should exclude samples at or above MAX_VELOCITY (50)", () => {
    stats.onVelocity(50); // excluded (not < 50)
    stats.onVelocity(60); // excluded
    stats.onVelocity(5);

    // Only 5 is counted → avg = 5 / 1 = 5
    expect(stats.getState().velocityAvg).toBe(5);
  });

  it("should return 0 velocityAvg when no valid samples exist", () => {
    stats.onVelocity(0); // excluded
    stats.onVelocity(100); // excluded

    expect(stats.getState().velocityAvg).toBe(0);
  });

  it("should set velocity to 0 when fed 0", () => {
    stats.onVelocity(5);
    stats.onVelocity(0);

    expect(stats.getState().velocity).toBe(0);
  });
});

// =============================================================================
// getItemCount — edge cases
// =============================================================================

describe("getItemCount — edge cases", () => {
  it("should return 0 when total is 0", () => {
    const stats = createStats(makeConfig({ getTotal: () => 0 }));

    expect(stats.getState().itemCount).toBe(0);
  });

  it("should return 0 when itemSize is 0", () => {
    const stats = createStats(makeConfig({ getItemSize: () => 0 }));

    expect(stats.getState().itemCount).toBe(0);
  });

  it("should return 0 when itemSize is negative", () => {
    const stats = createStats(makeConfig({ getItemSize: () => -10 }));

    expect(stats.getState().itemCount).toBe(0);
  });

  it("should return 0 when containerSize is 0", () => {
    const stats = createStats(makeConfig({ getContainerSize: () => 0 }));

    expect(stats.getState().itemCount).toBe(0);
  });

  it("should return 0 when containerSize is negative", () => {
    const stats = createStats(makeConfig({ getContainerSize: () => -100 }));

    expect(stats.getState().itemCount).toBe(0);
  });
});

// =============================================================================
// getItemCount — basic geometry
// =============================================================================

describe("getItemCount — basic geometry", () => {
  it("should count visible items at scroll position 0", () => {
    // containerSize=500, itemSize=50 → 10 visible rows → 10 items
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().itemCount).toBe(10);
  });

  it("should count items when scrolled partially", () => {
    // scrollPosition=100 is already the logical offset
    // ceil((100 + 500) / 50) = ceil(12) = 12
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 100,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().itemCount).toBe(12);
  });

  it("should not exceed total", () => {
    // scrollPosition very large, but result capped at total
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 999999,
        getTotal: () => 20,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().itemCount).toBeLessThanOrEqual(20);
  });

  it("should return total when all items fit in container", () => {
    // 5 items × 50px = 250px total, container = 500px → all visible
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 5,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().itemCount).toBe(5);
  });

  it("should handle partial row at bottom", () => {
    // scrollPosition=25, containerSize=500, itemSize=50
    // ceil((25 + 500) / 50) = ceil(10.5) = 11
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 25,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().itemCount).toBe(11);
  });
});

// =============================================================================
// getItemCount — large logical ranges
// =============================================================================

describe("getItemCount — large logical ranges", () => {
  it("counts only the initial viewport in a million-row list", () => {
    const stats=createStats(makeConfig({getTotal:()=>1000000}));
    expect(stats.getState().itemCount).toBe(10);
  });
  it("reaches the last item at the real maximum", () => {
    const stats=createStats(makeConfig({getTotal:()=>1000000,getScrollPosition:()=>50000000-500}));
    expect(stats.getState().itemCount).toBe(1000000);
  });
  it("uses the same direct mapping for small lists", () => {
    const stats=createStats(makeConfig({getScrollPosition:()=>200}));
    expect(stats.getState().itemCount).toBe(14);
  });
  it("keeps large-grid progress in logical coordinates", () => {
    const stats=createStats(makeConfig({getTotal:()=>2000000,getColumns:()=>2,getItemSize:()=>48,getContainerSize:()=>480,getScrollPosition:()=>23999760}));
    expect(stats.getState().itemCount).toBe(1000010);
    expect(stats.getState().progress).toBeCloseTo(50.0005,6);
  });
});

// =============================================================================
// getItemCount — grid / columns
// =============================================================================

describe("getItemCount — grid / columns", () => {
  it("should default columns to 1 when getColumns is not provided", () => {
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    // Same as single-column: ceil(500/50) * 1 = 10
    expect(stats.getState().itemCount).toBe(10);
  });

  it("should account for columns in item count", () => {
    // 100 items, 4 columns → 25 rows
    // containerSize=500, itemSize=50 → 10 visible rows × 4 cols = 40 items
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
        getColumns: () => 4,
      })
    );

    expect(stats.getState().itemCount).toBe(40);
  });

  it("should cap at total even with columns", () => {
    // 10 items, 4 columns → 3 rows (ceil(10/4))
    // totalActualSize = 3 * 50 = 150 < containerSize(500) → all visible
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 10,
        getItemSize: () => 50,
        getContainerSize: () => 500,
        getColumns: () => 4,
      })
    );

    expect(stats.getState().itemCount).toBe(10);
  });

  it("should handle scrolled grid", () => {
    // 1000 items, 5 columns → 200 rows
    // totalActualSize = 200 * 40 = 8000
    // scrollPosition=200 → actualOffset=200
    // visibleRows = ceil((200 + 600) / 40) = ceil(20) = 20
    // itemCount = min(20 * 5, 1000) = 100
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 200,
        getTotal: () => 1000,
        getItemSize: () => 40,
        getContainerSize: () => 600,
        getColumns: () => 5,
      })
    );

    expect(stats.getState().itemCount).toBe(100);
  });
});

// =============================================================================
// progress
// =============================================================================

describe("progress", () => {
  it("should be 0 when total is 0", () => {
    const stats = createStats(makeConfig({ getTotal: () => 0 }));

    expect(stats.getState().progress).toBe(0);
  });

  it("should be 100 when all items are visible", () => {
    // 5 items × 50px = 250px < containerSize 500 → all visible → 100%
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 5,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().progress).toBe(100);
  });

  it("should be between 0 and 100 for partial scroll", () => {
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 100,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    const { progress } = stats.getState();
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(100);
  });

  it("should clamp to 100 max", () => {
    // Even with huge scroll, progress can't exceed 100
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 999999,
        getTotal: () => 10,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    expect(stats.getState().progress).toBeLessThanOrEqual(100);
  });

  it("should equal (itemCount / total) * 100", () => {
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 100,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    const state = stats.getState();
    const expected = (state.itemCount / state.total) * 100;
    expect(state.progress).toBe(expected);
  });
});

// =============================================================================
// getState — full snapshot
// =============================================================================

describe("getState — full snapshot", () => {
  it("should return all fields", () => {
    const stats = createStats(makeConfig());
    const state = stats.getState();

    expect(state).toHaveProperty("progress");
    expect(state).toHaveProperty("velocity");
    expect(state).toHaveProperty("velocityAvg");
    expect(state).toHaveProperty("itemCount");
    expect(state).toHaveProperty("total");
  });

  it("should return a fresh object each call", () => {
    const stats = createStats(makeConfig());

    const a = stats.getState();
    const b = stats.getState();

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("should reflect velocity changes", () => {
    const stats = createStats(makeConfig());

    expect(stats.getState().velocity).toBe(0);

    stats.onVelocity(7);
    expect(stats.getState().velocity).toBe(7);
  });

  it("should reflect dynamic config changes", () => {
    let scrollPos = 0;
    const stats = createStats(
      makeConfig({ getScrollPosition: () => scrollPos })
    );

    const count1 = stats.getState().itemCount;
    scrollPos = 500;
    const count2 = stats.getState().itemCount;

    expect(count2).toBeGreaterThan(count1);
  });
});

// =============================================================================
// Content shorter than the viewport
// =============================================================================

describe("content shorter than the viewport", () => {
  it("counts every item when no scrolling is possible", () => {
    // 2 items × 50px = 100 < containerSize 500
    const stats = createStats(
      makeConfig({
        getScrollPosition: () => 0,
        getTotal: () => 2,
        getItemSize: () => 50,
        getContainerSize: () => 500,
      })
    );

    // ceil(500/50)=10 visible rows, capped at the two actual items.
    expect(stats.getState().itemCount).toBe(2);
  });
});
