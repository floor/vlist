/**
 * vlist - Table Layout Tests
 * Tests for the table layout module: column resolution, resize, offsets,
 * flex distribution, min/max clamping, and edge cases.
 */

import { describe, it, expect } from "bun:test";
import { createTableLayout } from "../../../src/features/table/layout";
import type { TableColumn } from "../../../src/features/table/types";
import type { VListItem } from "../../../src/types";

// =============================================================================
// Helpers
// =============================================================================

/** Create a simple column definition */
const col = (
  key: string,
  opts: Partial<TableColumn> = {},
): TableColumn => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  ...opts,
});

// =============================================================================
// Factory
// =============================================================================

describe("createTableLayout", () => {
  it("should create a layout with the given columns", () => {
    const layout = createTableLayout([col("a"), col("b"), col("c")]);
    expect(layout.columns.length).toBe(3);
  });

  it("should start with totalWidth 0 before resolve", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    // Before resolve, widths are not computed
    expect(layout.totalWidth).toBe(0);
  });

  it("should handle empty columns array", () => {
    const layout = createTableLayout([]);
    layout.resolve(800);
    expect(layout.columns.length).toBe(0);
    expect(layout.totalWidth).toBe(0);
  });
});

// =============================================================================
// resolve — Fixed Widths
// =============================================================================

describe("resolve with fixed widths", () => {
  it("should assign explicit widths to columns", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);

    expect(layout.columns[0]!.width).toBe(100);
    expect(layout.columns[1]!.width).toBe(200);
    expect(layout.columns[2]!.width).toBe(150);
    expect(layout.totalWidth).toBe(450);
  });

  it("should compute cumulative offsets", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);

    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[1]!.offset).toBe(100);
    expect(layout.columns[2]!.offset).toBe(300);
  });

  it("should not stretch columns when total < container", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 100 }),
    ]);

    layout.resolve(800);

    // Fixed columns don't stretch
    expect(layout.totalWidth).toBe(200);
  });

  it("should allow total > container (horizontal scroll)", () => {
    const layout = createTableLayout([
      col("a", { width: 500 }),
      col("b", { width: 500 }),
    ]);

    layout.resolve(600);

    expect(layout.totalWidth).toBe(1000);
  });
});

// =============================================================================
// resolve — Flex Widths (no explicit width)
// =============================================================================

describe("resolve with flex widths", () => {
  it("should distribute container width equally among flex columns", () => {
    const layout = createTableLayout([col("a"), col("b"), col("c")]);

    layout.resolve(900);

    expect(layout.columns[0]!.width).toBe(300);
    expect(layout.columns[1]!.width).toBe(300);
    expect(layout.columns[2]!.width).toBe(300);
    expect(layout.totalWidth).toBe(900);
  });

  it("should distribute remaining space after fixed columns", () => {
    const layout = createTableLayout([
      col("a", { width: 200 }),
      col("b"),
      col("c"),
    ]);

    layout.resolve(800);

    expect(layout.columns[0]!.width).toBe(200);
    expect(layout.columns[1]!.width).toBe(300);
    expect(layout.columns[2]!.width).toBe(300);
    expect(layout.totalWidth).toBe(800);
  });

  it("should handle all fixed + one flex column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c"),
    ]);

    layout.resolve(600);

    expect(layout.columns[2]!.width).toBe(300);
    expect(layout.totalWidth).toBe(600);
  });

  it("should handle single flex column taking all space", () => {
    const layout = createTableLayout([col("a")]);

    layout.resolve(500);

    expect(layout.columns[0]!.width).toBe(500);
    expect(layout.totalWidth).toBe(500);
  });

  it("should handle zero remaining space for flex columns", () => {
    const layout = createTableLayout([
      col("a", { width: 400 }),
      col("b", { width: 400 }),
      col("c"),
    ]);

    layout.resolve(800);

    // c gets 0 remaining space, but clamped to minWidth (default 50)
    expect(layout.columns[2]!.width).toBe(50);
  });

  it("should handle negative remaining space gracefully", () => {
    const layout = createTableLayout([
      col("a", { width: 500 }),
      col("b", { width: 500 }),
      col("c"),
    ]);

    layout.resolve(600);

    // Remaining = 600 - 1000 = -400, clamped to 0, then clamped to minWidth
    expect(layout.columns[2]!.width).toBe(50);
    // Total exceeds container — will scroll
    expect(layout.totalWidth).toBe(1050);
  });
});

// =============================================================================
// resolve — Min/Max Width Clamping
// =============================================================================

describe("resolve with min/max clamping", () => {
  it("should clamp explicit width to minWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 20, minWidth: 80 }),
    ]);

    layout.resolve(400);

    expect(layout.columns[0]!.width).toBe(80);
  });

  it("should clamp explicit width to maxWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 500, maxWidth: 200 }),
    ]);

    layout.resolve(400);

    expect(layout.columns[0]!.width).toBe(200);
  });

  it("should clamp flex width to minWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 780 }),
      col("b", { minWidth: 100 }),
    ]);

    layout.resolve(800);

    // Remaining = 20, but minWidth = 100
    expect(layout.columns[1]!.width).toBe(100);
  });

  it("should clamp flex width to maxWidth", () => {
    const layout = createTableLayout([
      col("a", { maxWidth: 150 }),
    ]);

    layout.resolve(800);

    // Flex would get 800, but maxWidth = 150
    expect(layout.columns[0]!.width).toBe(150);
  });

  it("should use global minColumnWidth as default", () => {
    const layout = createTableLayout(
      [col("a", { width: 10 })],
      80, // globalMinWidth
    );

    layout.resolve(400);

    expect(layout.columns[0]!.width).toBe(80);
  });

  it("should use global maxColumnWidth as default", () => {
    const layout = createTableLayout(
      [col("a")],
      50,   // globalMinWidth
      200,  // globalMaxWidth
    );

    layout.resolve(800);

    expect(layout.columns[0]!.width).toBe(200);
  });

  it("should prefer column-level min/max over global defaults", () => {
    const layout = createTableLayout(
      [col("a", { width: 30, minWidth: 40 })],
      80, // globalMinWidth would be 80
    );

    layout.resolve(400);

    // Column minWidth (40) overrides global (80)
    expect(layout.columns[0]!.width).toBe(40);
  });

  it("should handle minWidth > maxWidth by clamping to maxWidth", () => {
    // Edge case: minWidth 200, maxWidth 100 — max wins via Math.min(max, Math.max(min, v))
    const layout = createTableLayout([
      col("a", { width: 150, minWidth: 200, maxWidth: 100 }),
    ]);

    layout.resolve(400);

    // clamp(150, 200, 100) => Math.min(100, Math.max(200, 150)) = Math.min(100, 200) = 100
    expect(layout.columns[0]!.width).toBe(100);
  });
});

// =============================================================================
// resolve — Resizable Flag
// =============================================================================

describe("resolve with resizable flag", () => {
  it("should mark columns as resizable by default", () => {
    const layout = createTableLayout([col("a")]);
    layout.resolve(400);
    expect(layout.columns[0]!.resizable).toBe(true);
  });

  it("should respect column-level resizable: false", () => {
    const layout = createTableLayout([col("a", { resizable: false })]);
    layout.resolve(400);
    expect(layout.columns[0]!.resizable).toBe(false);
  });

  it("should respect global resizable: false", () => {
    const layout = createTableLayout(
      [col("a")],
      50,       // globalMinWidth
      Infinity, // globalMaxWidth
      false,    // globalResizable
    );
    layout.resolve(400);
    expect(layout.columns[0]!.resizable).toBe(false);
  });

  it("should allow column-level override of global resizable", () => {
    const layout = createTableLayout(
      [col("a", { resizable: true }), col("b")],
      50,       // globalMinWidth
      Infinity, // globalMaxWidth
      false,    // globalResizable
    );
    layout.resolve(400);
    expect(layout.columns[0]!.resizable).toBe(true);
    expect(layout.columns[1]!.resizable).toBe(false);
  });
});

// =============================================================================
// resizeColumn
// =============================================================================

describe("resizeColumn", () => {
  it("should resize a column to the given width", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);
    const actual = layout.resizeColumn(1, 300);

    expect(actual).toBe(300);
    expect(layout.columns[1]!.width).toBe(300);
  });

  it("should recalculate offsets after resize", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);
    layout.resizeColumn(0, 150);

    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[1]!.offset).toBe(150); // was 100
    expect(layout.columns[2]!.offset).toBe(350); // was 300
  });

  it("should update totalWidth after resize", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(800);
    expect(layout.totalWidth).toBe(300);

    layout.resizeColumn(0, 200);
    expect(layout.totalWidth).toBe(400);
  });

  it("should clamp resize to minWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 200, minWidth: 80 }),
    ]);

    layout.resolve(400);
    const actual = layout.resizeColumn(0, 30);

    expect(actual).toBe(80);
    expect(layout.columns[0]!.width).toBe(80);
  });

  it("should clamp resize to maxWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 200, maxWidth: 300 }),
    ]);

    layout.resolve(400);
    const actual = layout.resizeColumn(0, 500);

    expect(actual).toBe(300);
    expect(layout.columns[0]!.width).toBe(300);
  });

  it("should not resize non-resizable columns", () => {
    const layout = createTableLayout([
      col("a", { width: 200, resizable: false }),
    ]);

    layout.resolve(400);
    const actual = layout.resizeColumn(0, 300);

    expect(actual).toBe(200);
    expect(layout.columns[0]!.width).toBe(200);
  });

  it("should return 0 for out-of-bounds index", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    layout.resolve(400);

    expect(layout.resizeColumn(-1, 200)).toBe(0);
    expect(layout.resizeColumn(5, 200)).toBe(0);
  });

  it("should handle resizing the last column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 100 }),
      col("c", { width: 100 }),
    ]);

    layout.resolve(600);
    layout.resizeColumn(2, 250);

    expect(layout.columns[2]!.width).toBe(250);
    expect(layout.totalWidth).toBe(450);
    // Offsets of earlier columns should be unchanged
    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[1]!.offset).toBe(100);
    expect(layout.columns[2]!.offset).toBe(200);
  });

  it("should handle resizing the first column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 100 }),
      col("c", { width: 100 }),
    ]);

    layout.resolve(600);
    layout.resizeColumn(0, 200);

    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[1]!.offset).toBe(200);
    expect(layout.columns[2]!.offset).toBe(300);
    expect(layout.totalWidth).toBe(400);
  });
});

// =============================================================================
// getColumn
// =============================================================================

describe("getColumn", () => {
  it("should return the resolved column at the given index", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(400);

    const c = layout.getColumn(0);
    expect(c).toBeDefined();
    expect(c!.def.key).toBe("a");
    expect(c!.width).toBe(100);
    expect(c!.index).toBe(0);
  });

  it("should return undefined for out-of-bounds index", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    layout.resolve(400);

    expect(layout.getColumn(-1)).toBeUndefined();
    expect(layout.getColumn(5)).toBeUndefined();
  });
});

// =============================================================================
// getColumnAtX
// =============================================================================

describe("getColumnAtX", () => {
  it("should find the column containing a given x position", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);

    expect(layout.getColumnAtX(0)!.def.key).toBe("a");
    expect(layout.getColumnAtX(50)!.def.key).toBe("a");
    expect(layout.getColumnAtX(99)!.def.key).toBe("a");
    expect(layout.getColumnAtX(100)!.def.key).toBe("b");
    expect(layout.getColumnAtX(200)!.def.key).toBe("b");
    expect(layout.getColumnAtX(299)!.def.key).toBe("b");
    expect(layout.getColumnAtX(300)!.def.key).toBe("c");
    expect(layout.getColumnAtX(449)!.def.key).toBe("c");
  });

  it("should return first column for negative x", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(400);

    expect(layout.getColumnAtX(-10)!.def.key).toBe("a");
  });

  it("should return last column for x >= totalWidth", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(400);

    expect(layout.getColumnAtX(500)!.def.key).toBe("b");
    expect(layout.getColumnAtX(300)!.def.key).toBe("b");
  });

  it("should return undefined for empty columns", () => {
    const layout = createTableLayout([]);
    layout.resolve(400);

    expect(layout.getColumnAtX(50)).toBeUndefined();
  });
});

// =============================================================================
// getColumnOffset
// =============================================================================

describe("getColumnOffset", () => {
  it("should return the cumulative offset for each column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 150 }),
      col("c", { width: 200 }),
    ]);

    layout.resolve(800);

    expect(layout.getColumnOffset(0)).toBe(0);
    expect(layout.getColumnOffset(1)).toBe(100);
    expect(layout.getColumnOffset(2)).toBe(250);
  });

  it("should return 0 for out-of-bounds index", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    layout.resolve(400);

    expect(layout.getColumnOffset(-1)).toBe(0);
    expect(layout.getColumnOffset(5)).toBe(0);
  });
});

// =============================================================================
// getColumnWidth
// =============================================================================

describe("getColumnWidth", () => {
  it("should return the width for each column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(400);

    expect(layout.getColumnWidth(0)).toBe(100);
    expect(layout.getColumnWidth(1)).toBe(200);
  });

  it("should return 0 for out-of-bounds index", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    layout.resolve(400);

    expect(layout.getColumnWidth(-1)).toBe(0);
    expect(layout.getColumnWidth(5)).toBe(0);
  });
});

// =============================================================================
// updateColumns
// =============================================================================

describe("updateColumns", () => {
  it("should replace column definitions", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(800);
    expect(layout.columns.length).toBe(2);

    layout.updateColumns([
      col("x", { width: 150 }),
      col("y", { width: 250 }),
      col("z", { width: 100 }),
    ]);

    layout.resolve(800);

    expect(layout.columns.length).toBe(3);
    expect(layout.columns[0]!.def.key).toBe("x");
    expect(layout.columns[1]!.def.key).toBe("y");
    expect(layout.columns[2]!.def.key).toBe("z");
    expect(layout.totalWidth).toBe(500);
  });

  it("should reset offsets after column update", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(800);
    expect(layout.columns[1]!.offset).toBe(100);

    layout.updateColumns([
      col("x", { width: 300 }),
      col("y", { width: 200 }),
    ]);

    layout.resolve(800);
    expect(layout.columns[1]!.offset).toBe(300);
  });

  it("should handle reducing to fewer columns", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);

    layout.updateColumns([col("x", { width: 300 })]);
    layout.resolve(800);

    expect(layout.columns.length).toBe(1);
    expect(layout.totalWidth).toBe(300);
  });

  it("should handle expanding to more columns", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);

    layout.resolve(800);

    layout.updateColumns([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 300 }),
      col("d", { width: 150 }),
    ]);

    layout.resolve(800);

    expect(layout.columns.length).toBe(4);
    expect(layout.totalWidth).toBe(750);
  });
});

// =============================================================================
// Re-resolve (container resize)
// =============================================================================

describe("re-resolve on container resize", () => {
  it("should redistribute flex columns on container resize", () => {
    const layout = createTableLayout([col("a"), col("b")]);

    layout.resolve(600);
    expect(layout.columns[0]!.width).toBe(300);
    expect(layout.columns[1]!.width).toBe(300);

    layout.resolve(1000);
    expect(layout.columns[0]!.width).toBe(500);
    expect(layout.columns[1]!.width).toBe(500);
  });

  it("should not change fixed columns on container resize", () => {
    const layout = createTableLayout([
      col("a", { width: 200 }),
      col("b"),
    ]);

    layout.resolve(600);
    expect(layout.columns[0]!.width).toBe(200);
    expect(layout.columns[1]!.width).toBe(400);

    layout.resolve(1000);
    expect(layout.columns[0]!.width).toBe(200);
    expect(layout.columns[1]!.width).toBe(800);
  });

  it("should recalculate offsets on container resize", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b"),
      col("c", { width: 100 }),
    ]);

    layout.resolve(400);
    expect(layout.columns[1]!.offset).toBe(100);
    expect(layout.columns[1]!.width).toBe(200);
    expect(layout.columns[2]!.offset).toBe(300);

    layout.resolve(600);
    expect(layout.columns[1]!.offset).toBe(100);
    expect(layout.columns[1]!.width).toBe(400);
    expect(layout.columns[2]!.offset).toBe(500);
  });

  it("should not lose manually resized widths on re-resolve", () => {
    // After a manual resize, the column has an explicit width set via resizeColumn.
    // However, resolve() reads from the original column defs, so it will
    // recalculate. This is expected behavior — resize is ephemeral until
    // the consumer persists it.
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(600);
    layout.resizeColumn(0, 150);
    expect(layout.columns[0]!.width).toBe(150);

    // Re-resolve resets to original def widths
    layout.resolve(600);
    expect(layout.columns[0]!.width).toBe(100);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  it("should handle single column", () => {
    const layout = createTableLayout([col("a", { width: 100 })]);
    layout.resolve(800);

    expect(layout.columns.length).toBe(1);
    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[0]!.width).toBe(100);
    expect(layout.totalWidth).toBe(100);
  });

  it("should handle container width of 0", () => {
    const layout = createTableLayout([col("a"), col("b")]);
    layout.resolve(0);

    // Flex columns get 0 remaining, clamped to minWidth (50)
    expect(layout.columns[0]!.width).toBe(50);
    expect(layout.columns[1]!.width).toBe(50);
    expect(layout.totalWidth).toBe(100);
  });

  it("should handle very large number of columns", () => {
    const cols = Array.from({ length: 50 }, (_, i) =>
      col(`col${i}`, { width: 60 }),
    );
    const layout = createTableLayout(cols);
    layout.resolve(1000);

    expect(layout.columns.length).toBe(50);
    expect(layout.totalWidth).toBe(3000);
    expect(layout.columns[49]!.offset).toBe(2940);
  });

  it("should handle mix of fixed and flex with varying min/max", () => {
    const layout = createTableLayout([
      col("fixed", { width: 200 }),
      col("flex-small", { minWidth: 50, maxWidth: 100 }),
      col("flex-large", { minWidth: 200 }),
    ]);

    layout.resolve(600);

    // Remaining = 400, split between 2 flex columns = 200 each
    expect(layout.columns[0]!.width).toBe(200);
    // flex-small: clamp(200, 50, 100) = 100
    expect(layout.columns[1]!.width).toBe(100);
    // flex-large: clamp(200, 200, Infinity) = 200
    expect(layout.columns[2]!.width).toBe(200);
    expect(layout.totalWidth).toBe(500);
  });

  it("should preserve column index in resolved columns", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
      col("c", { width: 150 }),
    ]);

    layout.resolve(800);

    expect(layout.columns[0]!.index).toBe(0);
    expect(layout.columns[1]!.index).toBe(1);
    expect(layout.columns[2]!.index).toBe(2);
  });

  it("should preserve column def reference in resolved columns", () => {
    const colA = col("a", { width: 100, sortable: true });
    const layout = createTableLayout([colA]);
    layout.resolve(400);

    expect(layout.columns[0]!.def).toBe(colA);
    expect(layout.columns[0]!.def.sortable).toBe(true);
  });

  it("should handle minWidth of 1 (smallest valid)", () => {
    const layout = createTableLayout(
      [col("a", { width: 0 })],
      1, // globalMinWidth = 1
    );
    layout.resolve(400);

    // width 0 clamped to minWidth 1
    expect(layout.columns[0]!.width).toBe(1);
  });

  it("should handle repeated resolve calls idempotently", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b"),
    ]);

    layout.resolve(500);
    const w1 = layout.columns[1]!.width;
    const o1 = layout.columns[1]!.offset;

    layout.resolve(500);
    expect(layout.columns[1]!.width).toBe(w1);
    expect(layout.columns[1]!.offset).toBe(o1);
  });

  it("should handle fractional container width", () => {
    const layout = createTableLayout([col("a"), col("b")]);
    layout.resolve(501);

    // 501 / 2 = 250.5 each
    expect(layout.columns[0]!.width).toBe(250.5);
    expect(layout.columns[1]!.width).toBe(250.5);
    expect(layout.totalWidth).toBe(501);
  });
});

// =============================================================================
// Multiple resizeColumn calls
// =============================================================================

describe("multiple resize operations", () => {
  it("should handle sequential resizes on the same column", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ]);

    layout.resolve(600);

    layout.resizeColumn(0, 150);
    expect(layout.columns[0]!.width).toBe(150);
    expect(layout.totalWidth).toBe(350);

    layout.resizeColumn(0, 80);
    expect(layout.columns[0]!.width).toBe(80);
    expect(layout.totalWidth).toBe(280);

    layout.resizeColumn(0, 120);
    expect(layout.columns[0]!.width).toBe(120);
    expect(layout.totalWidth).toBe(320);
  });

  it("should handle resizes on different columns", () => {
    const layout = createTableLayout([
      col("a", { width: 100 }),
      col("b", { width: 100 }),
      col("c", { width: 100 }),
    ]);

    layout.resolve(600);

    layout.resizeColumn(0, 200);
    layout.resizeColumn(2, 50);

    expect(layout.columns[0]!.width).toBe(200);
    expect(layout.columns[1]!.width).toBe(100);
    expect(layout.columns[2]!.width).toBe(50);

    expect(layout.columns[0]!.offset).toBe(0);
    expect(layout.columns[1]!.offset).toBe(200);
    expect(layout.columns[2]!.offset).toBe(300);

    expect(layout.totalWidth).toBe(350);
  });
});