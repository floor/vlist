/**
 * vlist - Masonry Layout Tests
 * Tests for the masonry layout module: shortest-lane placement, visibility,
 * cross-axis sizing, total size calculation, and configuration updates.
 */

import { describe, it, expect } from "bun:test";
import { createMasonryLayout } from "../../../src/features/masonry/layout";
import type { MasonryLayout, ItemPlacement } from "../../../src/features/masonry/types";

// =============================================================================
// Factory
// =============================================================================

describe("createMasonryLayout", () => {
  it("should create a masonry layout with the given columns", () => {
    const layout = createMasonryLayout({ columns: 4, containerSize: 800 });
    expect(layout.columns).toBe(4);
    expect(layout.gap).toBe(0);
    expect(layout.containerSize).toBe(800);
  });

  it("should default gap to 0", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    expect(layout.gap).toBe(0);
  });

  it("should use the provided gap", () => {
    const layout = createMasonryLayout({ columns: 4, gap: 8, containerSize: 800 });
    expect(layout.gap).toBe(8);
  });

  it("should clamp columns to at least 1", () => {
    const layout = createMasonryLayout({ columns: 0, containerSize: 800 });
    expect(layout.columns).toBe(1);
  });

  it("should floor fractional columns", () => {
    const layout = createMasonryLayout({ columns: 3.7, containerSize: 800 });
    expect(layout.columns).toBe(3);
  });

  it("should handle negative columns by clamping to 1", () => {
    const layout = createMasonryLayout({ columns: -5, containerSize: 800 });
    expect(layout.columns).toBe(1);
  });
});

// =============================================================================
// calculateLayout — shortest-lane algorithm
// =============================================================================

describe("calculateLayout", () => {
  it("should return empty array for 0 items", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(0, () => 100);
    expect(placements).toEqual([]);
  });

  it("should return empty array for negative item count", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(-5, () => 100);
    expect(placements).toEqual([]);
  });

  it("should place items in round-robin when all heights are equal", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    // All items same height → fills columns sequentially
    const placements = layout.calculateLayout(6, () => 100);

    // First three items → one per column at y=0
    expect(placements[0]!.lane).toBe(0);
    expect(placements[0]!.y).toBe(0);
    expect(placements[1]!.lane).toBe(1);
    expect(placements[1]!.y).toBe(0);
    expect(placements[2]!.lane).toBe(2);
    expect(placements[2]!.y).toBe(0);

    // Second row → starts from lane 0 again (all lanes equal)
    expect(placements[3]!.lane).toBe(0);
    expect(placements[3]!.y).toBe(100);
    expect(placements[4]!.lane).toBe(1);
    expect(placements[4]!.y).toBe(100);
    expect(placements[5]!.lane).toBe(2);
    expect(placements[5]!.y).toBe(100);
  });

  it("should place items in shortest lane with variable heights", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const heights = [300, 100, 100, 100];
    // Item 0 → lane 0, height 300 → lane 0 = 300
    // Item 1 → lane 1 (shortest), height 100 → lane 1 = 100
    // Item 2 → lane 1 (still shortest, 100 < 300), height 100 → lane 1 = 200
    // Item 3 → lane 1 (still shortest, 200 < 300), height 100 → lane 1 = 300

    const placements = layout.calculateLayout(4, (i) => heights[i]!);

    expect(placements[0]!.lane).toBe(0);
    expect(placements[0]!.y).toBe(0);

    expect(placements[1]!.lane).toBe(1);
    expect(placements[1]!.y).toBe(0);

    expect(placements[2]!.lane).toBe(1);
    expect(placements[2]!.y).toBe(100);

    expect(placements[3]!.lane).toBe(1);
    expect(placements[3]!.y).toBe(200);
  });

  it("should include gap in y offset between items in same lane", () => {
    const layout = createMasonryLayout({ columns: 2, gap: 10, containerSize: 400 });
    const heights = [100, 200, 100];
    // Item 0 → lane 0, y=0, lane0 = 100+10 = 110
    // Item 1 → lane 1 (shortest, 0 < 110), y=0, lane1 = 200+10 = 210
    // Item 2 → lane 0 (shortest, 110 < 210), y=110, lane0 = 110+100+10 = 220

    const placements = layout.calculateLayout(3, (i) => heights[i]!);

    expect(placements[0]!.y).toBe(0);
    expect(placements[1]!.y).toBe(0);
    expect(placements[2]!.y).toBe(110); // 100 + 10 gap
  });

  it("should set correct x coordinates based on lane", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 300 });
    // colWidth = 100
    const placements = layout.calculateLayout(3, () => 50);

    expect(placements[0]!.x).toBe(0);
    expect(placements[1]!.x).toBe(100);
    expect(placements[2]!.x).toBe(200);
  });

  it("should set correct x coordinates with gap", () => {
    const layout = createMasonryLayout({ columns: 3, gap: 10, containerSize: 300 });
    // totalGap = 2*10 = 20, available = 280, colWidth = 280/3 ≈ 93.33
    // stride = 93.33 + 10 = 103.33
    const placements = layout.calculateLayout(3, () => 50);

    expect(placements[0]!.x).toBe(0);
    expect(placements[1]!.x).toBeCloseTo(103.33, 1);
    expect(placements[2]!.x).toBeCloseTo(206.67, 1);
  });

  it("should set correct crossSize on each placement", () => {
    const layout = createMasonryLayout({ columns: 4, containerSize: 800 });
    const placements = layout.calculateLayout(4, () => 200);

    for (const p of placements) {
      expect(p.crossSize).toBe(200); // 800 / 4
    }
  });

  it("should set correct crossSize with gap", () => {
    const layout = createMasonryLayout({ columns: 4, gap: 8, containerSize: 800 });
    const placements = layout.calculateLayout(4, () => 200);

    for (const p of placements) {
      expect(p.crossSize).toBe(194); // (800 - 24) / 4
    }
  });

  it("should set correct size from the size function", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const heights = [150, 250, 300, 100];
    const placements = layout.calculateLayout(4, (i) => heights[i]!);

    expect(placements[0]!.size).toBe(150);
    expect(placements[1]!.size).toBe(250);
    expect(placements[2]!.size).toBe(300);
    expect(placements[3]!.size).toBe(100);
  });

  it("should set correct index on each placement", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(5, () => 100);

    for (let i = 0; i < 5; i++) {
      expect(placements[i]!.index).toBe(i);
    }
  });

  it("should handle single column (degenerates to vertical list)", () => {
    const layout = createMasonryLayout({ columns: 1, containerSize: 400 });
    const placements = layout.calculateLayout(4, () => 100);

    // All items in lane 0, stacked vertically
    for (let i = 0; i < 4; i++) {
      expect(placements[i]!.lane).toBe(0);
      expect(placements[i]!.x).toBe(0);
      expect(placements[i]!.y).toBe(i * 100);
    }
  });

  it("should handle single column with gap", () => {
    const layout = createMasonryLayout({ columns: 1, gap: 10, containerSize: 400 });
    const placements = layout.calculateLayout(3, () => 100);

    expect(placements[0]!.y).toBe(0);
    expect(placements[1]!.y).toBe(110); // 100 + 10
    expect(placements[2]!.y).toBe(220); // 210 + 10
  });

  it("should handle more columns than items", () => {
    const layout = createMasonryLayout({ columns: 10, containerSize: 1000 });
    const placements = layout.calculateLayout(3, () => 100);

    // Each item gets its own lane
    expect(placements[0]!.lane).toBe(0);
    expect(placements[1]!.lane).toBe(1);
    expect(placements[2]!.lane).toBe(2);

    // All at y=0
    for (const p of placements) {
      expect(p.y).toBe(0);
    }
  });

  it("should handle single item", () => {
    const layout = createMasonryLayout({ columns: 4, containerSize: 800 });
    const placements = layout.calculateLayout(1, () => 250);

    expect(placements).toHaveLength(1);
    expect(placements[0]!.index).toBe(0);
    expect(placements[0]!.lane).toBe(0);
    expect(placements[0]!.x).toBe(0);
    expect(placements[0]!.y).toBe(0);
    expect(placements[0]!.size).toBe(250);
    expect(placements[0]!.crossSize).toBe(200);
  });

  it("should handle large number of items", () => {
    const layout = createMasonryLayout({ columns: 4, gap: 8, containerSize: 800 });
    const placements = layout.calculateLayout(10000, (i) => 100 + (i % 5) * 50);

    expect(placements).toHaveLength(10000);

    // All indices should be present
    for (let i = 0; i < 10000; i++) {
      expect(placements[i]!.index).toBe(i);
    }

    // All lanes should be 0-3
    for (const p of placements) {
      expect(p.lane).toBeGreaterThanOrEqual(0);
      expect(p.lane).toBeLessThan(4);
    }
  });
});

// =============================================================================
// calculateLayout — shortest-lane tie-breaking
// =============================================================================

describe("calculateLayout - tie-breaking", () => {
  it("should prefer the first lane when multiple lanes are tied", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 300 });
    // All heights equal → first 3 fill lanes 0,1,2
    // Item 3 should go to lane 0 (first shortest)
    const placements = layout.calculateLayout(4, () => 100);
    expect(placements[3]!.lane).toBe(0);
  });
});

// =============================================================================
// getTotalSize
// =============================================================================

describe("getTotalSize", () => {
  it("should return 0 for empty placements", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    expect(layout.getTotalSize([])).toBe(0);
  });

  it("should return height of single item", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(1, () => 200);
    expect(layout.getTotalSize(placements)).toBe(200);
  });

  it("should return tallest lane with equal heights", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    // 6 items of height 100 in 3 columns → 2 per column → total = 200
    const placements = layout.calculateLayout(6, () => 100);
    expect(layout.getTotalSize(placements)).toBe(200);
  });

  it("should return tallest lane with variable heights", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const heights = [300, 100, 100];
    // lane 0: item0 (300)
    // lane 1: item1 (100) + item2 (100) = 200
    // tallest = 300
    const placements = layout.calculateLayout(3, (i) => heights[i]!);
    expect(layout.getTotalSize(placements)).toBe(300);
  });

  it("should include gap in total size calculation", () => {
    const layout = createMasonryLayout({ columns: 1, gap: 10, containerSize: 400 });
    // Single column: item0 (100), gap, item1 (100), gap, item2 (100)
    // lane size after each: 110, 220, 320
    // but getTotalSize reports max(y + size) = 220 + 100 = 320
    const placements = layout.calculateLayout(3, () => 100);
    expect(layout.getTotalSize(placements)).toBe(320);
  });

  it("should be consistent with calculateLayout for equal heights", () => {
    const layout = createMasonryLayout({ columns: 4, gap: 8, containerSize: 800 });
    const count = 100;
    const height = 150;
    const placements = layout.calculateLayout(count, () => height);
    const total = layout.getTotalSize(placements);

    // 100 items / 4 columns = 25 rows, each 150px with 24 gaps of 8px
    // 25 * 150 + 24 * 8 = 3750 + 192 = 3942
    expect(total).toBe(3942);
  });
});

// =============================================================================
// getVisibleItems
// =============================================================================

describe("getVisibleItems", () => {
  it("should return empty array for empty placements", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const visible = layout.getVisibleItems([], 0, 500);
    expect(visible).toEqual([]);
  });

  it("should return all items if viewport covers everything", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(6, () => 100);
    const total = layout.getTotalSize(placements);

    const visible = layout.getVisibleItems(placements, 0, total + 100);
    expect(visible).toHaveLength(6);
  });

  it("should return only items within the viewport range", () => {
    const layout = createMasonryLayout({ columns: 1, containerSize: 400 });
    // Single column: items at y = 0, 100, 200, 300, 400, 500
    const placements = layout.calculateLayout(6, () => 100);

    // Viewport from 150 to 350 — items at y=100 (100-200) and y=200 (200-300) and y=300 (300-400)
    const visible = layout.getVisibleItems(placements, 150, 350);
    const visibleIndices = visible.map((p) => p.index);

    expect(visibleIndices).toContain(1); // y=100, ends at 200 > 150
    expect(visibleIndices).toContain(2); // y=200, starts at 200 < 350
    expect(visibleIndices).toContain(3); // y=300, starts at 300 < 350
    expect(visibleIndices).not.toContain(0); // y=0, ends at 100 ≤ 150
    expect(visibleIndices).not.toContain(4); // y=400, starts at 400 ≥ 350 — not visible
  });

  it("should include items that partially overlap the viewport", () => {
    const layout = createMasonryLayout({ columns: 1, containerSize: 400 });
    const placements = layout.calculateLayout(3, () => 200);
    // Items: y=0..200, y=200..400, y=400..600

    // Viewport from 100 to 300 — items 0 and 1 overlap
    const visible = layout.getVisibleItems(placements, 100, 300);
    const visibleIndices = visible.map((p) => p.index);

    expect(visibleIndices).toContain(0); // ends at 200 > 100
    expect(visibleIndices).toContain(1); // starts at 200 < 300
    expect(visibleIndices).not.toContain(2); // starts at 400 ≥ 300
  });

  it("should return items from multiple lanes", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    const placements = layout.calculateLayout(9, () => 100);
    // 3 rows of 3 items each: y=0, y=100, y=200

    // Viewport covers first row only
    const visible = layout.getVisibleItems(placements, 0, 50);
    expect(visible).toHaveLength(3); // all 3 items in first row
  });

  it("should handle viewport starting from scrolled position", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const placements = layout.calculateLayout(20, () => 100);

    // Scroll to middle
    const visible = layout.getVisibleItems(placements, 400, 800);
    for (const p of visible) {
      const itemEnd = p.y + p.size;
      const itemStart = p.y;
      // Item must overlap [400, 800]
      expect(itemEnd).toBeGreaterThan(400);
      expect(itemStart).toBeLessThan(800);
    }
  });

  it("should return no items if viewport is past all content", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const placements = layout.calculateLayout(4, () => 100);
    const total = layout.getTotalSize(placements);

    const visible = layout.getVisibleItems(placements, total + 100, total + 500);
    expect(visible).toHaveLength(0);
  });

  it("should return no items if viewport is before all content", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const placements = layout.calculateLayout(4, () => 100);

    const visible = layout.getVisibleItems(placements, -500, -100);
    expect(visible).toHaveLength(0);
  });

  it("should handle zero-height viewport at a gap between items", () => {
    const layout = createMasonryLayout({ columns: 1, containerSize: 400 });
    // Single column: items at y=0..100, y=100..200, y=200..300
    const placements = layout.calculateLayout(3, () => 100);

    // Point exactly at item boundary — item0 ends at 100, item1 starts at 100
    // itemEnd > 100 is false for item0, itemStart < 100 is false for item1
    const visible = layout.getVisibleItems(placements, 100, 100);
    expect(visible).toHaveLength(0);
  });
});

// =============================================================================
// update
// =============================================================================

describe("update", () => {
  it("should update columns", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    expect(layout.columns).toBe(3);

    layout.update({ columns: 5 });
    expect(layout.columns).toBe(5);
  });

  it("should clamp updated columns to at least 1", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    layout.update({ columns: 0 });
    expect(layout.columns).toBe(1);
  });

  it("should floor updated fractional columns", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    layout.update({ columns: 4.9 });
    expect(layout.columns).toBe(4);
  });

  it("should update gap", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    expect(layout.gap).toBe(0);

    layout.update({ gap: 12 });
    expect(layout.gap).toBe(12);
  });

  it("should update containerSize", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    expect(layout.containerSize).toBe(600);

    layout.update({ containerSize: 1000 });
    expect(layout.containerSize).toBe(1000);
  });

  it("should update multiple properties at once", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 600 });
    layout.update({ columns: 5, gap: 16, containerSize: 1200 });

    expect(layout.columns).toBe(5);
    expect(layout.gap).toBe(16);
    expect(layout.containerSize).toBe(1200);
  });

  it("should affect cross-axis size after update", () => {
    const layout = createMasonryLayout({ columns: 4, containerSize: 800 });
    const p1 = layout.calculateLayout(1, () => 100);
    expect(p1[0]!.crossSize).toBe(200);

    layout.update({ containerSize: 400 });
    const p2 = layout.calculateLayout(1, () => 100);
    expect(p2[0]!.crossSize).toBe(100);
  });

  it("should produce different layout after column update", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const p2 = layout.calculateLayout(6, () => 100);
    const total2 = layout.getTotalSize(p2);

    layout.update({ columns: 3 });
    const p3 = layout.calculateLayout(6, () => 100);
    const total3 = layout.getTotalSize(p3);

    // 6 items in 2 cols = 3 rows × 100 = 300
    // 6 items in 3 cols = 2 rows × 100 = 200
    expect(total2).toBe(300);
    expect(total3).toBe(200);
  });
});

// =============================================================================
// Shortest-lane correctness — complex scenarios
// =============================================================================

describe("calculateLayout - complex scenarios", () => {
  it("should balance lanes with alternating tall/short items", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const heights = [200, 100, 100, 200];
    // Item 0 → lane 0, y=0, lane0=200
    // Item 1 → lane 1 (0 < 200), y=0, lane1=100
    // Item 2 → lane 1 (100 < 200), y=100, lane1=200
    // Item 3 → lane 0 (200 == 200, first wins), y=200, lane0=400

    const placements = layout.calculateLayout(4, (i) => heights[i]!);

    expect(placements[0]!).toMatchObject({ x: 0, y: 0, lane: 0 });
    expect(placements[1]!).toMatchObject({ x: 200, y: 0, lane: 1 });
    expect(placements[2]!).toMatchObject({ x: 200, y: 100, lane: 1 });
    expect(placements[3]!).toMatchObject({ x: 0, y: 200, lane: 0 });
  });

  it("should pack items into shortest lane across 3 columns", () => {
    const layout = createMasonryLayout({ columns: 3, containerSize: 300 });
    // colWidth = 100
    const heights = [100, 200, 150, 50, 100];
    // Item 0 → lane 0, y=0, lane0=100
    // Item 1 → lane 1 (0 < 100), y=0, lane1=200
    // Item 2 → lane 2 (0 < 100), y=0, lane2=150
    // Item 3 → lane 0 (100 < 150 < 200), y=100, lane0=150
    // Item 4 → lane 2 (150 == 150, lane 0 first? No, lane 0 = 150, lane 2 = 150, first wins = lane 0)
    // Actually: lane0=150, lane1=200, lane2=150 → lane 0 is first shortest

    const placements = layout.calculateLayout(5, (i) => heights[i]!);

    expect(placements[0]!.lane).toBe(0);
    expect(placements[1]!.lane).toBe(1);
    expect(placements[2]!.lane).toBe(2);
    expect(placements[3]!.lane).toBe(0);
    expect(placements[4]!.lane).toBe(0); // lane 0 ties with lane 2, first wins
    expect(placements[4]!.y).toBe(150);
  });

  it("should handle items with height 0", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const placements = layout.calculateLayout(4, () => 0);

    // All heights 0 → all at y=0 in round-robin
    for (const p of placements) {
      expect(p.y).toBe(0);
      expect(p.size).toBe(0);
    }
  });

  it("should handle very large heights", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 400 });
    const placements = layout.calculateLayout(2, () => 1_000_000);

    expect(placements[0]!.size).toBe(1_000_000);
    expect(placements[1]!.size).toBe(1_000_000);
    expect(layout.getTotalSize(placements)).toBe(1_000_000);
  });
});

// =============================================================================
// Visibility with gap
// =============================================================================

describe("getVisibleItems - with gap", () => {
  it("should correctly determine visibility when gap separates items", () => {
    const layout = createMasonryLayout({ columns: 1, gap: 20, containerSize: 400 });
    // Items: y=0..100, y=120..220, y=240..340, y=360..460
    const placements = layout.calculateLayout(4, () => 100);

    // Viewport 110-130 — only item 1 (y=120..220) overlaps
    const visible = layout.getVisibleItems(placements, 110, 130);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.index).toBe(1);
  });

  it("should include gap area between items in visibility range", () => {
    const layout = createMasonryLayout({ columns: 1, gap: 50, containerSize: 400 });
    // Items: y=0..100, y=150..250, y=300..400
    const placements = layout.calculateLayout(3, () => 100);

    // Viewport 100-150 — in the gap between item 0 and 1
    // item 0 ends at 100, item 1 starts at 150 — neither overlaps [100, 150]
    // itemEnd(0) = 100, !> 100. itemStart(1) = 150, !< 150.
    const visible = layout.getVisibleItems(placements, 100, 150);
    expect(visible).toHaveLength(0);
  });
});

// =============================================================================
// Round-trip verification
// =============================================================================

describe("round-trip: layout → visibility → all items found", () => {
  it("should find every item visible when scanning the entire height", () => {
    const layout = createMasonryLayout({ columns: 4, gap: 8, containerSize: 800 });
    const totalItems = 100;
    const placements = layout.calculateLayout(totalItems, (i) => 100 + (i % 5) * 50);
    const totalSize = layout.getTotalSize(placements);

    const visible = layout.getVisibleItems(placements, 0, totalSize);
    expect(visible).toHaveLength(totalItems);
  });

  it("should produce no duplicate indices in visible items", () => {
    const layout = createMasonryLayout({ columns: 3, gap: 4, containerSize: 600 });
    const placements = layout.calculateLayout(50, (i) => 80 + (i % 7) * 30);
    const totalSize = layout.getTotalSize(placements);

    const visible = layout.getVisibleItems(placements, 0, totalSize);
    const indices = visible.map((p) => p.index);
    const unique = new Set(indices);
    expect(unique.size).toBe(indices.length);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  it("should handle containerSize of 1", () => {
    const layout = createMasonryLayout({ columns: 2, containerSize: 1 });
    const placements = layout.calculateLayout(2, () => 100);
    expect(placements).toHaveLength(2);
    expect(placements[0]!.crossSize).toBe(0.5);
  });

  it("should handle very large column count with small container", () => {
    const layout = createMasonryLayout({ columns: 100, containerSize: 100 });
    const placements = layout.calculateLayout(5, () => 50);
    expect(placements[0]!.crossSize).toBe(1); // 100 / 100

    // 5 items each in their own lane
    for (let i = 0; i < 5; i++) {
      expect(placements[i]!.lane).toBe(i);
    }
  });

  it("should handle gap larger than item heights", () => {
    const layout = createMasonryLayout({ columns: 1, gap: 500, containerSize: 400 });
    const placements = layout.calculateLayout(3, () => 10);

    // Items: y=0..10, y=510..520, y=1020..1030
    expect(placements[0]!.y).toBe(0);
    expect(placements[1]!.y).toBe(510);
    expect(placements[2]!.y).toBe(1020);
  });

  it("should maintain item order within indices", () => {
    const layout = createMasonryLayout({ columns: 5, gap: 4, containerSize: 1000 });
    const placements = layout.calculateLayout(500, (i) => 50 + (i * 7) % 200);

    for (let i = 0; i < placements.length; i++) {
      expect(placements[i]!.index).toBe(i);
    }
  });
});