/**
 * vlist v2 — Grid 2D Keyboard Navigation Tests
 *
 * Tests that grid plugin configures navConfig with ud=columns, lr=1
 * so that ArrowUp/Down moves by rows and ArrowLeft/Right moves by columns.
 * Integration with the a11y plugin keyboard handler.
 *
 * Note: focusIdx starts at -1. The first key press computes n = -1 + delta.
 * For grid with columns=3: first ArrowDown → -1+3 = 2 (not 0).
 * Tests use Home to initialize focus to 0 where a known starting position
 * is required.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { grid } from "../../../src/plugins/grid";
import { a11y } from "../../../src/plugins/a11y";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function createGridList(count: number, columns: number, opts: { height?: number; gap?: number } = {}) {
  const container = createContainer({ width: 300, height: 500 });
  const items = createTestItems(count);
  const vlist = createVList<TestItem>(
    {
      container,
      items,
      item: { height: opts.height ?? 50, template: simpleTemplate },
    },
    [grid({ columns, gap: opts.gap ?? 0 }), a11y()],
  );
  return { vlist, container, items };
}

function getContent(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".vlist-content");
  if (!el) throw new Error("vlist-content not found");
  return el;
}

function fireKey(content: HTMLElement, key: string): void {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

function getFocusedIndex(content: HTMLElement): number {
  const desc = content.getAttribute("aria-activedescendant");
  if (!desc) return -1;
  const match = desc.match(/vlist-item-(\d+)/);
  return match ? parseInt(match[1]!, 10) : -1;
}

/** Initialize focus to index 0 using Home key */
function initFocus(content: HTMLElement): void {
  fireKey(content, "Home");
}

// =============================================================================
// Arrow Down/Up — moves by columns (row navigation)
// =============================================================================

describe("grid keyboard nav — ArrowDown/Up (row movement)", () => {
  it("ArrowDown moves focus by columns count (skips a row)", async () => {
    const { vlist, container } = createGridList(20, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    // ArrowDown should move by 3 (columns) → index 3
    fireKey(content, "ArrowDown");
    await flush();
    expect(getFocusedIndex(content)).toBe(3);

    // Another ArrowDown → index 6
    fireKey(content, "ArrowDown");
    await flush();
    expect(getFocusedIndex(content)).toBe(6);

    vlist.destroy();
    container.remove();
  });

  it("ArrowUp moves focus back by columns count", async () => {
    const { vlist, container } = createGridList(20, 4);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    // Navigate down: 0 → 4 → 8
    fireKey(content, "ArrowDown"); // → 4
    fireKey(content, "ArrowDown"); // → 8
    await flush();
    expect(getFocusedIndex(content)).toBe(8);

    // ArrowUp should move back by 4 → index 4
    fireKey(content, "ArrowUp");
    await flush();
    expect(getFocusedIndex(content)).toBe(4);

    vlist.destroy();
    container.remove();
  });

  it("ArrowDown with 2 columns moves by 2", async () => {
    const { vlist, container } = createGridList(10, 2);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowDown"); // → 2
    await flush();
    expect(getFocusedIndex(content)).toBe(2);

    fireKey(content, "ArrowDown"); // → 4
    await flush();
    expect(getFocusedIndex(content)).toBe(4);

    vlist.destroy();
    container.remove();
  });

  it("first ArrowDown from unfocused state lands at columns-1", async () => {
    // This tests the actual behavior: focusIdx starts at -1,
    // ArrowDown computes n = -1 + columns
    const { vlist, container } = createGridList(20, 3);
    await flush();

    const content = getContent(container);
    fireKey(content, "ArrowDown"); // -1 + 3 = 2
    await flush();
    expect(getFocusedIndex(content)).toBe(2);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Arrow Left/Right — moves by 1 (column navigation)
// =============================================================================

describe("grid keyboard nav — ArrowLeft/Right (column movement)", () => {
  it("ArrowRight moves focus by 1 within a row", async () => {
    const { vlist, container } = createGridList(12, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    fireKey(content, "ArrowRight"); // → 1
    await flush();
    expect(getFocusedIndex(content)).toBe(1);

    fireKey(content, "ArrowRight"); // → 2
    await flush();
    expect(getFocusedIndex(content)).toBe(2);

    vlist.destroy();
    container.remove();
  });

  it("ArrowLeft moves focus back by 1", async () => {
    const { vlist, container } = createGridList(12, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowRight"); // → 1
    fireKey(content, "ArrowRight"); // → 2
    await flush();
    expect(getFocusedIndex(content)).toBe(2);

    fireKey(content, "ArrowLeft"); // → 1
    await flush();
    expect(getFocusedIndex(content)).toBe(1);

    vlist.destroy();
    container.remove();
  });

  it("ArrowRight can cross row boundary", async () => {
    const { vlist, container } = createGridList(12, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowRight"); // → 1
    fireKey(content, "ArrowRight"); // → 2
    fireKey(content, "ArrowRight"); // → 3 (next row)
    await flush();
    expect(getFocusedIndex(content)).toBe(3);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Boundary clamping
// =============================================================================

describe("grid keyboard nav — boundary clamping", () => {
  it("ArrowUp does not go below index 0", async () => {
    const { vlist, container } = createGridList(12, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    // ArrowUp from 0 with ud=3 → tries -3, clamped to 0
    fireKey(content, "ArrowUp");
    await flush();
    // Should stay at 0 (clamped, no change → no move event)
    expect(getFocusedIndex(content)).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("ArrowDown does not exceed last item", async () => {
    const { vlist, container } = createGridList(7, 3);
    await flush();

    const content = getContent(container);
    // End key to go to last item
    fireKey(content, "End"); // → 6
    await flush();
    expect(getFocusedIndex(content)).toBe(6);

    // ArrowDown from 6 with ud=3 → tries 9, clamped to 6
    fireKey(content, "ArrowDown");
    await flush();
    expect(getFocusedIndex(content)).toBe(6);

    vlist.destroy();
    container.remove();
  });

  it("ArrowLeft does not go below index 0", async () => {
    const { vlist, container } = createGridList(12, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    fireKey(content, "ArrowLeft"); // tries -1, clamped to 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Home / End
// =============================================================================

describe("grid keyboard nav — Home/End", () => {
  it("Home jumps to first item from any position", async () => {
    const { vlist, container } = createGridList(20, 4);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    // Navigate to some position
    fireKey(content, "ArrowDown"); // → 4
    fireKey(content, "ArrowDown"); // → 8
    fireKey(content, "ArrowRight"); // → 9
    await flush();
    expect(getFocusedIndex(content)).toBe(9);

    fireKey(content, "Home");
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    vlist.destroy();
    container.remove();
  });

  it("End jumps to last item", async () => {
    const { vlist, container } = createGridList(15, 3);
    await flush();

    const content = getContent(container);
    fireKey(content, "End");
    await flush();
    expect(getFocusedIndex(content)).toBe(14);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// PageUp / PageDown
// =============================================================================

describe("grid keyboard nav — PageUp/PageDown", () => {
  it("PageDown moves by visible rows * columns", async () => {
    const { vlist, container } = createGridList(100, 3, { height: 50 });
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    await flush();

    fireKey(content, "PageDown");
    await flush();

    // containerSize=500, rowHeight=50 → visRows=10, delta=10*3=30
    // from 0 → 30
    const idx = getFocusedIndex(content);
    expect(idx).toBe(30);

    vlist.destroy();
    container.remove();
  });

  it("PageUp moves back by visible rows * columns", async () => {
    const { vlist, container } = createGridList(100, 3, { height: 50 });
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "PageDown"); // → 30
    fireKey(content, "PageDown"); // → 60
    await flush();
    expect(getFocusedIndex(content)).toBe(60);

    fireKey(content, "PageUp"); // → 30
    await flush();
    expect(getFocusedIndex(content)).toBe(30);

    vlist.destroy();
    container.remove();
  });

  it("PageDown clamps at last item", async () => {
    const { vlist, container } = createGridList(10, 3, { height: 50 });
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "PageDown");
    await flush();

    // Would try to go to 30, but max is 9
    expect(getFocusedIndex(content)).toBe(9);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Mixed navigation patterns
// =============================================================================

describe("grid keyboard nav — mixed patterns", () => {
  it("can navigate a full grid using combination of arrows", async () => {
    // 3x3 grid (9 items), 3 columns
    const { vlist, container } = createGridList(9, 3);
    await flush();

    const content = getContent(container);

    // Row 0: 0, 1, 2
    // Row 1: 3, 4, 5
    // Row 2: 6, 7, 8

    initFocus(content); // → 0
    await flush();
    expect(getFocusedIndex(content)).toBe(0);

    fireKey(content, "ArrowRight"); // → 1
    expect(getFocusedIndex(content)).toBe(1);

    fireKey(content, "ArrowDown"); // → 4 (1 + 3)
    expect(getFocusedIndex(content)).toBe(4);

    fireKey(content, "ArrowLeft"); // → 3
    expect(getFocusedIndex(content)).toBe(3);

    fireKey(content, "ArrowDown"); // → 6 (3 + 3)
    expect(getFocusedIndex(content)).toBe(6);

    fireKey(content, "ArrowRight"); // → 7
    expect(getFocusedIndex(content)).toBe(7);

    fireKey(content, "ArrowUp"); // → 4 (7 - 3)
    expect(getFocusedIndex(content)).toBe(4);

    vlist.destroy();
    container.remove();
  });

  it("partial last row: ArrowDown from second-to-last row lands on partial row item", async () => {
    // 7 items, 3 columns:
    // Row 0: 0, 1, 2
    // Row 1: 3, 4, 5
    // Row 2: 6  (partial row)
    const { vlist, container } = createGridList(7, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowDown"); // → 3

    // ArrowDown from 3 → tries 6, exists → 6
    fireKey(content, "ArrowDown");
    await flush();
    expect(getFocusedIndex(content)).toBe(6);

    vlist.destroy();
    container.remove();
  });

  it("partial last row: ArrowDown from position without item below clamps", async () => {
    // 7 items, 3 columns:
    // Row 0: 0, 1, 2
    // Row 1: 3, 4, 5
    // Row 2: 6  (only 1 item)
    const { vlist, container } = createGridList(7, 3);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowRight"); // → 1
    fireKey(content, "ArrowDown"); // → 4

    // ArrowDown from 4 → tries 7, doesn't exist → clamped to 6
    fireKey(content, "ArrowDown");
    await flush();
    expect(getFocusedIndex(content)).toBe(6);

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Single column grid (degenerates to list)
// =============================================================================

describe("grid keyboard nav — single column", () => {
  it("behaves like a list when columns=1", async () => {
    const { vlist, container } = createGridList(5, 1);
    await flush();

    const content = getContent(container);
    initFocus(content); // → 0
    fireKey(content, "ArrowDown"); // → 1
    fireKey(content, "ArrowDown"); // → 2
    await flush();
    expect(getFocusedIndex(content)).toBe(2);

    fireKey(content, "ArrowUp"); // → 1
    await flush();
    expect(getFocusedIndex(content)).toBe(1);

    vlist.destroy();
    container.remove();
  });
});
