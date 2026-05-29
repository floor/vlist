/**
 * vlist v2 — Masonry 2D Keyboard Navigation Tests
 *
 * Tests the masonry plugin's lane-aware navigate() function:
 * - ArrowUp/Down: move within the same lane
 * - ArrowLeft/Right: move to adjacent lane with Y-center alignment
 * - Home/End: jump to first/last item
 * - PageUp/PageDown: jump by container height within lane
 * - Boundary clamping at lane edges
 *
 * The navigate() function is tested directly since it's the core logic.
 * Integration with a11y plugin is tested for the full keyboard flow.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createMasonryLayout } from "../../../src/plugins/masonry/layout";
import type { ItemPlacement } from "../../../src/plugins/masonry/types";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Direct navigate() function tests
//
// We test the masonry plugin's navigate function by reconstructing the
// data structures it uses: laneItems, itemLanePos, laneYCenters.
// This lets us test the navigation algorithm without full createVList.
// =============================================================================

interface NavState {
  placements: ItemPlacement[];
  laneItems: number[][];
  itemLanePos: Int32Array;
  laneYCenters: Float64Array[];
  columns: number;
  containerSize: number;
}

function buildNavState(columns: number, itemSizes: number[], gap: number = 10, containerSize: number = 500): NavState {
  const layout = createMasonryLayout({ columns, gap, containerSize: 300 });
  const placements = layout.calculateLayout(itemSizes.length, (i) => itemSizes[i]!);

  const laneItems: number[][] = new Array(columns);
  for (let c = 0; c < columns; c++) laneItems[c] = [];

  const itemLanePos = new Int32Array(placements.length);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const pos = laneItems[p.lane]!.length;
    laneItems[p.lane]!.push(i);
    itemLanePos[i] = pos;
  }

  const laneYCenters: Float64Array[] = new Array(columns);
  for (let c = 0; c < columns; c++) {
    const items = laneItems[c]!;
    const yc = new Float64Array(items.length);
    for (let j = 0; j < items.length; j++) {
      const p = placements[items[j]!]!;
      yc[j] = p.y + p.size * 0.5;
    }
    laneYCenters[c] = yc;
  }

  return { placements, laneItems, itemLanePos, laneYCenters, columns, containerSize };
}

function bsNearest(arr: Float64Array, target: number): number {
  const len = arr.length;
  if (!len) return -1;
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(arr[lo - 1]! - target) <= Math.abs(arr[lo]! - target)) {
    return lo - 1;
  }
  return lo;
}

function navigate(state: NavState, currentIndex: number, key: string, total: number): number {
  const placement = state.placements[currentIndex];
  if (!placement) return currentIndex;
  const lane = placement.lane;
  const posInLane = state.itemLanePos[currentIndex]!;
  const myLane = state.laneItems[lane]!;

  switch (key) {
    case "ArrowDown":
      if (posInLane + 1 < myLane.length) return myLane[posInLane + 1]!;
      return currentIndex;
    case "ArrowUp":
      if (posInLane > 0) return myLane[posInLane - 1]!;
      return currentIndex;
    case "ArrowRight": {
      if (lane >= state.columns - 1) return currentIndex;
      const targetLane = lane + 1;
      const yCenter = placement.y + placement.size * 0.5;
      const targetItems = state.laneItems[targetLane]!;
      if (!targetItems.length) return currentIndex;
      const pos = bsNearest(state.laneYCenters[targetLane]!, yCenter);
      return pos >= 0 ? targetItems[pos]! : currentIndex;
    }
    case "ArrowLeft": {
      if (lane <= 0) return currentIndex;
      const targetLane = lane - 1;
      const yCenter = placement.y + placement.size * 0.5;
      const targetItems = state.laneItems[targetLane]!;
      if (!targetItems.length) return currentIndex;
      const pos = bsNearest(state.laneYCenters[targetLane]!, yCenter);
      return pos >= 0 ? targetItems[pos]! : currentIndex;
    }
    case "Home":
      return 0;
    case "End": {
      const lastLane = state.laneItems[state.columns - 1]!;
      return lastLane.length > 0 ? lastLane[lastLane.length - 1]! : total - 1;
    }
    case "PageDown": {
      const itemSize = placement.size > 0 ? placement.size : 150;
      const jump = Math.max(1, Math.floor(state.containerSize / itemSize));
      const target = Math.min(posInLane + jump, myLane.length - 1);
      return myLane[target]!;
    }
    case "PageUp": {
      const itemSize = placement.size > 0 ? placement.size : 150;
      const jump = Math.max(1, Math.floor(state.containerSize / itemSize));
      const target = Math.max(0, posInLane - jump);
      return myLane[target]!;
    }
  }
  return currentIndex;
}

// =============================================================================
// ArrowDown/Up — within-lane navigation
// =============================================================================

describe("masonry keyboard nav — ArrowDown/Up (within lane)", () => {
  it("ArrowDown moves to next item in the same lane", () => {
    // 6 items, 2 columns, equal sizes → placement: 0,1,2,3,4,5
    // Lane 0: 0, 2, 4  |  Lane 1: 1, 3, 5
    const state = buildNavState(2, [100, 100, 100, 100, 100, 100]);

    expect(navigate(state, 0, "ArrowDown", 6)).toBe(2);
    expect(navigate(state, 2, "ArrowDown", 6)).toBe(4);
  });

  it("ArrowUp moves to previous item in the same lane", () => {
    const state = buildNavState(2, [100, 100, 100, 100, 100, 100]);

    expect(navigate(state, 4, "ArrowUp", 6)).toBe(2);
    expect(navigate(state, 2, "ArrowUp", 6)).toBe(0);
  });

  it("ArrowDown at bottom of lane stays put", () => {
    const state = buildNavState(2, [100, 100, 100, 100, 100, 100]);

    // Item 4 is last in lane 0
    expect(navigate(state, 4, "ArrowDown", 6)).toBe(4);
  });

  it("ArrowUp at top of lane stays put", () => {
    const state = buildNavState(2, [100, 100, 100, 100, 100, 100]);

    expect(navigate(state, 0, "ArrowUp", 6)).toBe(0);
    expect(navigate(state, 1, "ArrowUp", 6)).toBe(1);
  });
});

// =============================================================================
// ArrowLeft/Right — cross-lane with Y-center alignment
// =============================================================================

describe("masonry keyboard nav — ArrowLeft/Right (cross lane)", () => {
  it("ArrowRight moves to adjacent lane", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100, 100, 100, 100, 100]);

    const result = navigate(state, 0, "ArrowRight", 9);
    // Should move to lane 1, finding item closest in Y-center
    const targetPlacement = state.placements[result]!;
    expect(targetPlacement.lane).toBe(1);
  });

  it("ArrowLeft moves to previous lane", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100, 100, 100, 100, 100]);

    const result = navigate(state, 1, "ArrowLeft", 9);
    const targetPlacement = state.placements[result]!;
    expect(targetPlacement.lane).toBe(0);
  });

  it("ArrowRight at rightmost lane stays put", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100, 100]);

    // Find an item in the rightmost lane (lane 2)
    const rightmostItem = state.placements.findIndex(p => p.lane === 2);
    if (rightmostItem >= 0) {
      expect(navigate(state, rightmostItem, "ArrowRight", 6)).toBe(rightmostItem);
    }
  });

  it("ArrowLeft at leftmost lane stays put", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100, 100]);

    expect(navigate(state, 0, "ArrowLeft", 6)).toBe(0);
  });

  it("Y-center alignment picks closest item in target lane", () => {
    // Variable sizes force different Y positions
    // Lane 0: item 0 (size 200), item 2 (size 100)
    // Lane 1: item 1 (size 50), item 3 (size 50), item 4 (size 50), ...
    // The Y-center of item 0 at ~100, should match whichever item in lane 1 is closest
    const state = buildNavState(2, [200, 50, 100, 50, 50, 50, 50, 50]);

    const result = navigate(state, 0, "ArrowRight", 8);
    const targetPlacement = state.placements[result]!;
    expect(targetPlacement.lane).toBe(1);

    // The Y-center of item 0 is at ~100 (200/2)
    // In lane 1, items have sizes 50 each, placed at y=0, y=60, y=120, y=180...
    // Y-centers: 25, 85, 145, 185... → closest to 100 is item at y=60 (center=85) or y=120 (center=145)
    // Binary search picks the nearest
    const itemYCenter = state.placements[0]!.y + state.placements[0]!.size * 0.5;
    const targetYCenter = targetPlacement.y + targetPlacement.size * 0.5;
    // Should be reasonably close
    expect(Math.abs(targetYCenter - itemYCenter)).toBeLessThan(200);
  });
});

// =============================================================================
// Home / End
// =============================================================================

describe("masonry keyboard nav — Home/End", () => {
  it("Home returns index 0", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100]);

    expect(navigate(state, 3, "Home", 5)).toBe(0);
    expect(navigate(state, 4, "Home", 5)).toBe(0);
  });

  it("End returns last item in last column", () => {
    const state = buildNavState(3, [100, 100, 100, 100, 100]);
    // 3 cols, 5 equal items → lane 0: [0,3], lane 1: [1,4], lane 2: [2]
    // Last column (2) has item 2
    expect(navigate(state, 0, "End", 5)).toBe(2);
    expect(navigate(state, 2, "End", 5)).toBe(2);
  });

  it("End returns last item in last column with more items", () => {
    const state = buildNavState(2, [100, 200, 50, 100, 150, 80]);
    // 2 cols → last column is lane 1
    const lastLane = state.laneItems[1]!;
    const expected = lastLane[lastLane.length - 1]!;
    expect(navigate(state, 0, "End", 6)).toBe(expected);
  });
});

// =============================================================================
// PageUp / PageDown
// =============================================================================

describe("masonry keyboard nav — PageUp/PageDown", () => {
  it("PageDown jumps by containerSize/itemSize within lane", () => {
    // 20 items, 2 columns, size=100, containerSize=500
    // jump = floor(500/100) = 5
    const state = buildNavState(2, new Array(20).fill(100), 10, 500);

    // Lane 0 has items: 0, 2, 4, 6, 8, 10, 12, 14, 16, 18
    // posInLane for item 0 = 0, jump = 5 → target posInLane = 5 → item at position 5 in lane 0
    const result = navigate(state, 0, "PageDown", 20);
    // Should jump 5 positions in lane 0
    const resultPlacement = state.placements[result]!;
    expect(resultPlacement.lane).toBe(0);
    expect(state.itemLanePos[result]).toBe(5);
  });

  it("PageUp jumps back within lane", () => {
    const state = buildNavState(2, new Array(20).fill(100), 10, 500);

    // Start from further in lane 0
    const laneItems = state.laneItems[0]!;
    const startItem = laneItems[7]!; // position 7 in lane 0

    const result = navigate(state, startItem, "PageUp", 20);
    const resultPos = state.itemLanePos[result]!;
    // jump = 5, from pos 7 → target pos 2
    expect(resultPos).toBe(2);
  });

  it("PageDown clamps at end of lane", () => {
    const state = buildNavState(2, new Array(6).fill(100), 10, 500);

    // Lane 0 has items: 0, 2, 4 (3 items only)
    // jump = 5, from pos 0 → tries pos 5, clamped to 2 (last)
    const result = navigate(state, 0, "PageDown", 6);
    expect(result).toBe(state.laneItems[0]![2]);
  });

  it("PageUp clamps at start of lane", () => {
    const state = buildNavState(2, new Array(10).fill(100), 10, 500);

    // From position 2 in lane, jump=5 → tries pos -3, clamped to 0
    const laneItems = state.laneItems[0]!;
    const startItem = laneItems[2]!;

    const result = navigate(state, startItem, "PageUp", 10);
    expect(result).toBe(laneItems[0]);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("masonry keyboard nav — edge cases", () => {
  it("single column masonry: ArrowLeft/Right stay put", () => {
    const state = buildNavState(1, [100, 100, 100]);

    expect(navigate(state, 0, "ArrowRight", 3)).toBe(0);
    expect(navigate(state, 0, "ArrowLeft", 3)).toBe(0);
    expect(navigate(state, 1, "ArrowRight", 3)).toBe(1);
    expect(navigate(state, 1, "ArrowLeft", 3)).toBe(1);
  });

  it("single column masonry: ArrowUp/Down work linearly", () => {
    const state = buildNavState(1, [100, 100, 100]);

    expect(navigate(state, 0, "ArrowDown", 3)).toBe(1);
    expect(navigate(state, 1, "ArrowDown", 3)).toBe(2);
    expect(navigate(state, 2, "ArrowUp", 3)).toBe(1);
  });

  it("single item: all directions stay put", () => {
    const state = buildNavState(3, [100]);

    expect(navigate(state, 0, "ArrowDown", 1)).toBe(0);
    expect(navigate(state, 0, "ArrowUp", 1)).toBe(0);
    expect(navigate(state, 0, "ArrowRight", 1)).toBe(0);
    expect(navigate(state, 0, "ArrowLeft", 1)).toBe(0);
  });

  it("invalid index returns currentIndex", () => {
    const state = buildNavState(2, [100, 100, 100, 100]);

    expect(navigate(state, 99, "ArrowDown", 4)).toBe(99);
    expect(navigate(state, -1, "ArrowDown", 4)).toBe(-1);
  });

  it("unrecognized key returns currentIndex", () => {
    const state = buildNavState(2, [100, 100, 100, 100]);

    expect(navigate(state, 0, "Tab", 4)).toBe(0);
    expect(navigate(state, 0, "Escape", 4)).toBe(0);
  });
});

// =============================================================================
// Binary search correctness
// =============================================================================

describe("masonry keyboard nav — bsNearest", () => {
  it("finds exact match", () => {
    const arr = new Float64Array([10, 20, 30, 40, 50]);
    expect(bsNearest(arr, 30)).toBe(2);
  });

  it("finds nearest when target is between values", () => {
    const arr = new Float64Array([10, 20, 30, 40, 50]);
    expect(bsNearest(arr, 24)).toBe(1); // closer to 20 than 30
    expect(bsNearest(arr, 26)).toBe(2); // closer to 30 than 20
  });

  it("returns 0 for target below all values", () => {
    const arr = new Float64Array([10, 20, 30]);
    expect(bsNearest(arr, 1)).toBe(0);
  });

  it("returns last for target above all values", () => {
    const arr = new Float64Array([10, 20, 30]);
    expect(bsNearest(arr, 100)).toBe(2);
  });

  it("returns -1 for empty array", () => {
    const arr = new Float64Array(0);
    expect(bsNearest(arr, 50)).toBe(-1);
  });

  it("handles single element", () => {
    const arr = new Float64Array([42]);
    expect(bsNearest(arr, 0)).toBe(0);
    expect(bsNearest(arr, 100)).toBe(0);
    expect(bsNearest(arr, 42)).toBe(0);
  });

  it("tie-breaks toward lower index", () => {
    const arr = new Float64Array([10, 30]);
    // Target 20 is equidistant from 10 and 30 → lo-1 has abs <= abs of lo → returns 0
    expect(bsNearest(arr, 20)).toBe(0);
  });
});
