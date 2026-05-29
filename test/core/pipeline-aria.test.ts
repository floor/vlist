/**
 * vlist v2 — Pipeline ARIA & EngineState Tests
 *
 * Tests ARIA attribute handling in phase2Commit and the createEngineState factory.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createEngineState } from "../../src/core/state";
import { phase2Commit, createRenderConfig } from "../../src/core/pipeline";
import { createPool } from "../../src/core/pool";
import { compileHooks } from "../../src/core/hooks";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a minimal EngineState ready for phase2Commit with `count` visible items
 * starting at dataIndex 0.
 */
function makeState(totalItems: number, visibleCount: number): ReturnType<typeof createEngineState> {
  const state = createEngineState(20);
  state.totalItems = totalItems;
  state.visibleCount = visibleCount;
  for (let i = 0; i < visibleCount; i++) {
    state.visibleIndices[i] = i;
    state.visibleOffsets[i] = i * 50;
    state.visibleSizes[i] = 50;
  }
  return state;
}

function runCommit(
  state: ReturnType<typeof createEngineState>,
  items: TestItem[],
  rendered: Map<number, HTMLElement>,
  content: HTMLElement,
  interactive: boolean,
): void {
  const pool = createPool("vlist");
  const hooks = compileHooks([]);
  const rc = createRenderConfig("vlist", false, 0, 0, 0, "", 0);
  if (interactive) {
    rc.itemRole = "option";
    rc.interactive = true;
  }
  phase2Commit(
    state,
    pool,
    content,
    simpleTemplate as any,
    () => items,
    rendered,
    rc,
    hooks,
    null,
    null,
  );
}

// =============================================================================
// createEngineState
// =============================================================================

describe("createEngineState", () => {
  it("creates state with correct initial values", () => {
    const state = createEngineState(10);

    expect(state.capacity).toBe(10);
    expect(state.visibleIndices).toBeInstanceOf(Int32Array);
    expect(state.visibleIndices.length).toBe(10);
    expect(state.visibleOffsets).toBeInstanceOf(Float64Array);
    expect(state.visibleOffsets.length).toBe(10);
    expect(state.visibleSizes).toBeInstanceOf(Float64Array);
    expect(state.visibleSizes.length).toBe(10);

    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
    expect(state.totalSize).toBe(0);
    expect(state.scrollPosition).toBe(0);
    expect(state.prevScrollPosition).toBe(0);
    expect(state.scrollDirection).toBe(0);
    expect(state.containerSize).toBe(0);
    expect(state.crossSize).toBe(0);
    expect(state.totalItems).toBe(0);
    expect(state.prevRangeStart).toBe(0);
    expect(state.prevRangeEnd).toBe(-1);
    expect(state.renderPending).toBe(false);
    expect(state.initialized).toBe(false);
    expect(state.destroyed).toBe(false);
    expect(state.isCompressed).toBe(false);
    expect(state.compressionRatio).toBe(1);
    expect(state.prevAriaTotal).toBe(-1);
  });

  it("resizeCapacity grows buffers when needed", () => {
    const state = createEngineState(5);
    expect(state.capacity).toBe(5);

    // containerSize=600, minItemSize=50 → needed = ceil(600/50) + overscan*2 = 12 + 8 = 20 > 5
    state.resizeCapacity(600, 50);

    expect(state.capacity).toBeGreaterThan(5);
    expect(state.visibleIndices.length).toBe(state.capacity);
    expect(state.visibleOffsets.length).toBe(state.capacity);
    expect(state.visibleSizes.length).toBe(state.capacity);
  });

  it("resizeCapacity is a no-op when capacity is sufficient", () => {
    const state = createEngineState(100);
    const originalIndices = state.visibleIndices;

    // containerSize=100, minItemSize=50 → needed = 2 + 8 = 10 ≤ 100
    state.resizeCapacity(100, 50);

    expect(state.capacity).toBe(100);
    expect(state.visibleIndices).toBe(originalIndices);
  });

  it("clear resets visibleCount and startIndex", () => {
    const state = createEngineState(10);
    state.visibleCount = 7;
    state.startIndex = 3;

    state.clear();

    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
  });
});

// =============================================================================
// Pipeline ARIA — interactive: true
// =============================================================================

describe("phase2Commit — interactive: true", () => {
  it("acquired elements get role='option'", () => {
    const items = createTestItems(10);
    const state = makeState(10, 3);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, true);

    for (const [, el] of rendered) {
      expect(el.getAttribute("role")).toBe("option");
    }
  });

  it("acquired elements get aria-posinset equal to dataIndex + 1", () => {
    const items = createTestItems(10);
    const state = makeState(10, 5);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, true);

    for (const [dataIndex, el] of rendered) {
      expect(el.getAttribute("aria-posinset")).toBe(String(dataIndex + 1));
    }
  });

  it("acquired elements get aria-setsize equal to totalItems", () => {
    const items = createTestItems(10);
    const state = makeState(10, 4);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, true);

    for (const [, el] of rendered) {
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }
  });

  it("acquired elements get id = '{classPrefix}-item-{dataIndex}'", () => {
    const items = createTestItems(10);
    const state = makeState(10, 5);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, true);

    for (const [dataIndex, el] of rendered) {
      expect(el.id).toBe(`vlist-item-${dataIndex}`);
    }
  });

  it("after commit, state.prevAriaTotal equals state.totalItems", () => {
    const items = createTestItems(10);
    const state = makeState(10, 3);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    expect(state.prevAriaTotal).toBe(-1);
    runCommit(state, items, rendered, content, true);
    expect(state.prevAriaTotal).toBe(10);
  });
});

// =============================================================================
// Pipeline ARIA — interactive: false
// =============================================================================

describe("phase2Commit — interactive: false", () => {
  it("acquired elements get role='listitem'", () => {
    const items = createTestItems(10);
    const state = makeState(10, 3);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, false);

    for (const [, el] of rendered) {
      expect(el.getAttribute("role")).toBe("listitem");
    }
  });

  it("elements do not get aria-posinset or aria-setsize", () => {
    const items = createTestItems(10);
    const state = makeState(10, 4);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, false);

    for (const [, el] of rendered) {
      expect(el.hasAttribute("aria-posinset")).toBe(false);
      expect(el.hasAttribute("aria-setsize")).toBe(false);
    }
  });

  it("elements do not get id", () => {
    const items = createTestItems(10);
    const state = makeState(10, 4);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    runCommit(state, items, rendered, content, false);

    for (const [, el] of rendered) {
      expect(el.id).toBe("");
    }
  });
});

// =============================================================================
// Pipeline ARIA — totalItems change
// =============================================================================

describe("phase2Commit — totalItems change", () => {
  it("on first commit, all elements get aria-setsize (prevAriaTotal starts at -1)", () => {
    const items = createTestItems(10);
    const state = makeState(10, 5);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    // prevAriaTotal = -1 at start, totalItems = 10 → totalChanged = true for first commit
    expect(state.prevAriaTotal).toBe(-1);
    runCommit(state, items, rendered, content, true);

    expect(rendered.size).toBe(5);
    for (const [, el] of rendered) {
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }
  });

  it("on second commit with SAME totalItems, existing elements aria-setsize is not overwritten", () => {
    const items = createTestItems(10);
    const state = makeState(10, 3);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    // First commit — acquires elements
    runCommit(state, items, rendered, content, true);
    expect(state.prevAriaTotal).toBe(10);

    // Manually corrupt aria-setsize on existing elements to detect if they are touched
    for (const [, el] of rendered) {
      el.setAttribute("aria-setsize", "WRONG");
    }

    // Second commit — same totalItems, totalChanged = false → existing elements NOT updated
    runCommit(state, items, rendered, content, true);

    for (const [, el] of rendered) {
      expect(el.getAttribute("aria-setsize")).toBe("WRONG");
    }
  });

  it("on commit with changed totalItems, existing visible elements get updated aria-setsize", () => {
    const items = createTestItems(15);
    const state = makeState(10, 3);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");

    // First commit with totalItems = 10
    runCommit(state, items, rendered, content, true);
    expect(state.prevAriaTotal).toBe(10);
    for (const [, el] of rendered) {
      expect(el.getAttribute("aria-setsize")).toBe("10");
    }

    // Change totalItems to 15
    state.totalItems = 15;
    // Keep same visibleCount and indices (items 0-2 are still visible)
    state.visibleCount = 3;
    for (let i = 0; i < 3; i++) {
      state.visibleIndices[i] = i;
      state.visibleOffsets[i] = i * 50;
      state.visibleSizes[i] = 50;
    }

    // Second commit with changed totalItems — existing elements should get updated aria-setsize
    runCommit(state, items, rendered, content, true);

    for (const [, el] of rendered) {
      expect(el.getAttribute("aria-setsize")).toBe("15");
    }
    expect(state.prevAriaTotal).toBe(15);
  });
});
