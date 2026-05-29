/**
 * vlist v2 — phase1Calculate Unit Tests
 *
 * Exercises the range calculation engine in isolation.
 * Uses EngineState + SizeCache directly — no DOM required.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { phase1Calculate, phase2Commit, createRenderConfig } from "../../src/core/pipeline";
import { createEngineState } from "../../src/core/state";
import type { EngineState } from "../../src/core/state";
import { createSizeCache } from "../../src/core/sizes";
import type { SizeCache } from "../../src/core/sizes";
import type { CompiledHooks } from "../../src/core/types";
import { createPool } from "../../src/core/pool";
import { createTestItems, simpleTemplate } from "../helpers/factory";

// =============================================================================
// DOM Setup — required for Bun worker globals
// =============================================================================

beforeAll(() => { setupDOM(); });
afterAll(() => { teardownDOM(); });

// =============================================================================
// Helpers
// =============================================================================

/** Empty hooks — no plugins wired. */
function emptyHooks(): CompiledHooks {
  return {
    calculate: [],
    commit: [],
    afterScroll: [],
    idle: [],
    resize: [],
  };
}

/** Create a pre-configured state + size cache for typical fixed-size tests. */
function makeFixedSetup(opts: {
  totalItems: number;
  itemSize: number;
  containerSize: number;
  scrollPosition?: number;
  capacity?: number;
}): { state: EngineState; sizeCache: SizeCache } {
  const capacity = opts.capacity ?? Math.max(64, opts.totalItems + 20);
  const state = createEngineState(capacity);
  state.totalItems = opts.totalItems;
  state.containerSize = opts.containerSize;
  state.scrollPosition = opts.scrollPosition ?? 0;

  const sizeCache = createSizeCache(opts.itemSize, opts.totalItems);
  return { state, sizeCache };
}

// =============================================================================
// Tests
// =============================================================================

describe("phase1Calculate — range calculations", () => {
  it("returns true and fills buffers for basic range at scroll position 0", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBeGreaterThan(0);
    // At scroll 0 with 50px items in 500px container: visible 0-9, overscan 3 => render 0-13
    expect(state.startIndex).toBe(0);
    // Indices should start at 0
    expect(state.visibleIndices[0]).toBe(0);
  });

  it("calculates correct visible range when scrolled", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 250, // scrolled past 5 items
    });
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    // Scroll 250: visible starts at index 5, overscan -3 => render starts at 2
    expect(state.startIndex).toBe(2);
    // First rendered index should be renderStart
    expect(state.visibleIndices[0]).toBe(2);
  });

  it("returns false when range is unchanged (fast path)", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    // First call sets the range
    const first = phase1Calculate(state, sizeCache, 3, hooks);
    expect(first).toBe(true);

    // Second call with same state should return false (nothing changed)
    const second = phase1Calculate(state, sizeCache, 3, hooks);
    expect(second).toBe(false);
  });

  it("handles empty list (totalItems = 0)", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 0,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
  });

  it("handles zero container size", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 0,
    });
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
  });

  it("applies overscan to both sides of visible range", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 500, // visible: 10-19
    });
    const hooks = emptyHooks();

    const overscan = 5;
    phase1Calculate(state, sizeCache, overscan, hooks);

    // renderStart = max(0, 10 - 5) = 5
    expect(state.startIndex).toBe(5);
    // Should include items past the visible end too
    // visEnd ~= 20, renderEnd = min(99, 20 + 5) = 25
    // count = 25 - 5 + 1 = 21
    expect(state.visibleCount).toBeGreaterThanOrEqual(16); // at least visible + some overscan
  });

  it("clamps overscan start to 0", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 0, // at the beginning
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 10, hooks);

    // renderStart = max(0, 0 - 10) = 0
    expect(state.startIndex).toBe(0);
    expect(state.visibleIndices[0]).toBe(0);
  });

  it("clamps overscan end to totalItems - 1", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 20,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 500, // near the end: visible 10-19
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 10, hooks);

    // renderEnd = min(19, 20 + 10) = 19
    // All indices should be valid (<= 19)
    for (let i = 0; i < state.visibleCount; i++) {
      expect(state.visibleIndices[i]).toBeLessThanOrEqual(19);
      expect(state.visibleIndices[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles overscan=0", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 250,
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 0, hooks);

    // With zero overscan, renderStart = visStart, renderEnd = visEnd
    // Scroll 250 / 50 = 5, so visible starts at 5
    expect(state.startIndex).toBe(5);
    // Should only render exactly the visible items (+ 1 for ceiling)
    // 500/50 = 10 visible + 1 boundary = 11
    expect(state.visibleCount).toBeLessThanOrEqual(12);
  });

  it("handles single item", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 1,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBe(1);
    expect(state.startIndex).toBe(0);
    expect(state.visibleIndices[0]).toBe(0);
    expect(state.visibleSizes[0]).toBe(50);
    expect(state.visibleOffsets[0]).toBe(0);
  });

  it("works with variable height items", () => {
    const capacity = 128;
    const state = createEngineState(capacity);
    state.totalItems = 10;
    state.containerSize = 500;
    state.scrollPosition = 0;

    // Items: sizes 20, 40, 60, 80, 100, 120, 140, 160, 180, 200
    const sizeFn = (index: number): number => (index + 1) * 20;
    const sizeCache = createSizeCache(sizeFn, 10);
    const hooks = emptyHooks();

    const changed = phase1Calculate(state, sizeCache, 0, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBeGreaterThan(0);
    // Verify offsets are prefix sums of sizes
    // item 0: offset 0, size 20
    // item 1: offset 20, size 40
    // item 2: offset 60, size 60
    expect(state.visibleOffsets[0]).toBe(0);
    expect(state.visibleSizes[0]).toBe(20);
    if (state.visibleCount > 1) {
      expect(state.visibleOffsets[1]).toBe(20);
      expect(state.visibleSizes[1]).toBe(40);
    }
    if (state.visibleCount > 2) {
      expect(state.visibleOffsets[2]).toBe(60);
      expect(state.visibleSizes[2]).toBe(60);
    }
  });

  it("fills visibleIndices, visibleOffsets, visibleSizes correctly", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 50,
      itemSize: 100,
      containerSize: 500,
      scrollPosition: 0,
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 2, hooks);

    // Items are 100px, container 500px. Visible: 0-4 (5 items), overscan 2 => render 0-7 (8 items)
    // But visEnd gets +1, so visEnd could be 5 or 6 → renderEnd = 7 or 8
    for (let i = 0; i < state.visibleCount; i++) {
      const idx = state.visibleIndices[i]!;
      expect(state.visibleOffsets[i]).toBe(idx * 100);
      expect(state.visibleSizes[i]).toBe(100);
    }
  });

  it("sets state.startIndex to renderStart", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 300,
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 4, hooks);

    // scrollPos 300 / 50 = 6 visible start, renderStart = max(0, 6-4) = 2
    expect(state.startIndex).toBe(2);
    expect(state.visibleIndices[0]).toBe(state.startIndex);
  });

  it("sets state.totalSize from sizeCache", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 20,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 3, hooks);

    // 20 items * 50px = 1000px total
    expect(state.totalSize).toBe(1000);
  });

  it("handles very large scroll position", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 100000, // way past the end
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 3, hooks);

    // Should clamp to valid range — all indices must be < totalItems
    for (let i = 0; i < state.visibleCount; i++) {
      expect(state.visibleIndices[i]).toBeLessThan(100);
      expect(state.visibleIndices[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("applies startPadding offset to range start", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
      scrollPosition: 100,
    });
    const hooks = emptyHooks();

    // Without padding
    phase1Calculate(state, sizeCache, 0, hooks);
    const startNoPad = state.startIndex;

    // Reset state for a second calculation
    state.prevRangeStart = 0;
    state.prevRangeEnd = -1;

    // With padding: the visible range lookup subtracts startPadding from scrollPos,
    // so the range starts earlier (smaller index)
    phase1Calculate(state, sizeCache, 0, hooks, 50);
    const startWithPad = state.startIndex;

    // With 50px padding, the range should start at an earlier (or equal) index
    expect(startWithPad).toBeLessThanOrEqual(startNoPad);
  });

  it("resets to empty when container becomes 0", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    // First render normally
    phase1Calculate(state, sizeCache, 3, hooks);
    expect(state.visibleCount).toBeGreaterThan(0);

    // Container shrinks to 0
    state.containerSize = 0;
    state.prevRangeStart = 0;
    state.prevRangeEnd = -1;
    const changed = phase1Calculate(state, sizeCache, 3, hooks);

    expect(changed).toBe(true);
    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
  });

  it("handles renderPending flag", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 100,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    // First call sets prevRangeStart/End
    phase1Calculate(state, sizeCache, 3, hooks);
    expect(state.renderPending).toBe(false);

    // Second call would normally return false (fast path)
    const noChange = phase1Calculate(state, sizeCache, 3, hooks);
    expect(noChange).toBe(false);

    // Setting renderPending forces recalculation even though range is unchanged
    state.renderPending = true;
    const forced = phase1Calculate(state, sizeCache, 3, hooks);
    expect(forced).toBe(true);
    // renderPending should be cleared after execution
    expect(state.renderPending).toBe(false);
  });

  it("capacity safety cap prevents excessive rendering", () => {
    // Small capacity, but large range of items that would otherwise render
    const capacity = 5;
    const state = createEngineState(capacity);
    state.totalItems = 100;
    state.containerSize = 500;
    state.scrollPosition = 0;

    const sizeCache = createSizeCache(10, 100); // tiny items => many would be visible
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 3, hooks);

    // Should not exceed the buffer capacity
    expect(state.visibleCount).toBeLessThanOrEqual(capacity);
  });

  it("handles large overscan with small item count", () => {
    const { state, sizeCache } = makeFixedSetup({
      totalItems: 5,
      itemSize: 50,
      containerSize: 500,
    });
    const hooks = emptyHooks();

    phase1Calculate(state, sizeCache, 100, hooks);

    // Overscan 100 far exceeds item count — should clamp and render all 5
    expect(state.visibleCount).toBe(5);
    expect(state.startIndex).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect(state.visibleIndices[i]).toBe(i);
    }
  });
});

// =============================================================================
// phase2Commit — Multi-instance isolation
// =============================================================================

describe("phase2Commit — multiple instances do not interfere", () => {
  it("two instances releasing different items in the same frame produce correct results", () => {
    const items = createTestItems(20);
    const hooks = emptyHooks();
    const rc = createRenderConfig("vlist", false, 0, 0, 0, "", 0);

    // ── Instance A: renders items 0-9, then scrolls to show 5-14 ──
    const stateA = createEngineState(20);
    stateA.totalItems = 20;
    const poolA = createPool("vlist");
    const contentA = document.createElement("div");
    const renderedA = new Map<number, HTMLElement>();

    stateA.visibleCount = 10;
    for (let i = 0; i < 10; i++) {
      stateA.visibleIndices[i] = i;
      stateA.visibleOffsets[i] = i * 50;
      stateA.visibleSizes[i] = 50;
    }
    phase2Commit(stateA, poolA, contentA, simpleTemplate as any, () => items, renderedA, rc, hooks);
    expect(renderedA.size).toBe(10);

    // ── Instance B: renders items 10-19 ──
    const stateB = createEngineState(20);
    stateB.totalItems = 20;
    const poolB = createPool("vlist");
    const contentB = document.createElement("div");
    const renderedB = new Map<number, HTMLElement>();

    stateB.visibleCount = 10;
    for (let i = 0; i < 10; i++) {
      stateB.visibleIndices[i] = 10 + i;
      stateB.visibleOffsets[i] = (10 + i) * 50;
      stateB.visibleSizes[i] = 50;
    }
    phase2Commit(stateB, poolB, contentB, simpleTemplate as any, () => items, renderedB, rc, hooks);
    expect(renderedB.size).toBe(10);

    // ── Now scroll A to 5-14 and B to 15-19 in the same "frame" ──
    stateA.visibleCount = 10;
    for (let i = 0; i < 10; i++) {
      stateA.visibleIndices[i] = 5 + i;
      stateA.visibleOffsets[i] = (5 + i) * 50;
      stateA.visibleSizes[i] = 50;
    }

    stateB.visibleCount = 5;
    for (let i = 0; i < 5; i++) {
      stateB.visibleIndices[i] = 15 + i;
      stateB.visibleOffsets[i] = (15 + i) * 50;
      stateB.visibleSizes[i] = 50;
    }

    // Both commit in sequence (same synchronous frame)
    phase2Commit(stateA, poolA, contentA, simpleTemplate as any, () => items, renderedA, rc, hooks);
    phase2Commit(stateB, poolB, contentB, simpleTemplate as any, () => items, renderedB, rc, hooks);

    // A should have exactly items 5-14
    expect(renderedA.size).toBe(10);
    for (let i = 5; i <= 14; i++) {
      expect(renderedA.has(i)).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      expect(renderedA.has(i)).toBe(false);
    }

    // B should have exactly items 15-19
    expect(renderedB.size).toBe(5);
    for (let i = 15; i <= 19; i++) {
      expect(renderedB.has(i)).toBe(true);
    }
    for (let i = 10; i < 15; i++) {
      expect(renderedB.has(i)).toBe(false);
    }
  });
});

// =============================================================================
// phase2Commit — Contiguous release fast path
// =============================================================================

describe("phase2Commit — contiguous release fast path", () => {
  function setupCommitTest(totalItems: number) {
    const items = createTestItems(totalItems);
    const hooks = emptyHooks();
    const rc = createRenderConfig("vlist", false, 0, 0, 0, "", 0);
    const state = createEngineState(totalItems + 20);
    state.totalItems = totalItems;
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    return { items, hooks, rc, state, pool, content, rendered };
  }

  function fillState(state: EngineState, start: number, count: number, itemSize: number): void {
    state.visibleCount = count;
    for (let i = 0; i < count; i++) {
      state.visibleIndices[i] = start + i;
      state.visibleOffsets[i] = (start + i) * itemSize;
      state.visibleSizes[i] = itemSize;
    }
  }

  it("releases out-of-range items via range check for contiguous indices", () => {
    const { items, hooks, rc, state, pool, content, rendered } = setupCommitTest(30);

    fillState(state, 0, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);
    expect(rendered.size).toBe(10);

    fillState(state, 5, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);

    expect(rendered.size).toBe(10);
    for (let i = 0; i < 5; i++) expect(rendered.has(i)).toBe(false);
    for (let i = 5; i <= 14; i++) expect(rendered.has(i)).toBe(true);
  });

  it("releases correctly when scrolling backward", () => {
    const { items, hooks, rc, state, pool, content, rendered } = setupCommitTest(30);

    fillState(state, 10, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);
    expect(rendered.size).toBe(10);

    fillState(state, 5, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);

    expect(rendered.size).toBe(10);
    for (let i = 15; i <= 19; i++) expect(rendered.has(i)).toBe(false);
    for (let i = 5; i <= 14; i++) expect(rendered.has(i)).toBe(true);
  });

  it("returns released elements to the pool", () => {
    const { items, hooks, rc, state, pool, content, rendered } = setupCommitTest(30);

    fillState(state, 0, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);
    expect(pool.size).toBe(0);

    fillState(state, 10, 10, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);

    expect(pool.size).toBe(10);
    expect(rendered.size).toBe(10);
  });

  it("handles visibleCount = 0 without errors", () => {
    const { items, hooks, rc, state, pool, content, rendered } = setupCommitTest(20);

    fillState(state, 0, 5, 50);
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);
    expect(rendered.size).toBe(5);

    state.visibleCount = 0;
    phase2Commit(state, pool, content, simpleTemplate as any, () => items, rendered, rc, hooks);

    expect(rendered.size).toBe(0);
    expect(pool.size).toBe(5);
  });
});
