/**
 * vlist v2 — Padding Tests
 *
 * Tests padding resolution, pipeline transform offsets, cross-axis
 * inline styles, range calculation adjustment, and scrollToIndex alignment.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createEngineState } from "../../src/core/state";
import { phase1Calculate, phase2Commit, createRenderConfig } from "../../src/core/pipeline";
import { createPool } from "../../src/core/pool";
import { compileHooks } from "../../src/core/hooks";
import { createSizeCache } from "../../src/core/sizes";
import { resolvePadding, mainAxisPaddingFrom, crossAxisPaddingFrom } from "../../src/utils/padding";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

const ITEM_SIZE = 40;
const HOOKS = compileHooks([]);

function makeState(totalItems: number, visibleCount: number, scrollPos = 0): ReturnType<typeof createEngineState> {
  const state = createEngineState(200);
  state.totalItems = totalItems;
  state.containerSize = 400;
  state.scrollPosition = scrollPos;
  state.visibleCount = visibleCount;
  for (let i = 0; i < visibleCount; i++) {
    state.visibleIndices[i] = i;
    state.visibleOffsets[i] = i * ITEM_SIZE;
    state.visibleSizes[i] = ITEM_SIZE;
  }
  return state;
}

function collectTransforms(rendered: Map<number, HTMLElement>): Map<number, string> {
  const transforms = new Map<string, string>();
  const result = new Map<number, string>();
  rendered.forEach((el, idx) => {
    result.set(idx, el.style.transform);
  });
  return result;
}

// =============================================================================
// Padding Resolution (utils/padding.ts)
// =============================================================================

describe("resolvePadding", () => {
  it("returns zero singleton for undefined", () => {
    const p = resolvePadding(undefined);
    expect(p.top).toBe(0);
    expect(p.right).toBe(0);
    expect(p.bottom).toBe(0);
    expect(p.left).toBe(0);
  });

  it("returns zero singleton for 0", () => {
    const p = resolvePadding(0);
    expect(p).toBe(resolvePadding(undefined));
  });

  it("expands single number to all sides", () => {
    const p = resolvePadding(8);
    expect(p.top).toBe(8);
    expect(p.right).toBe(8);
    expect(p.bottom).toBe(8);
    expect(p.left).toBe(8);
  });

  it("expands [v, h] tuple", () => {
    const p = resolvePadding([10, 20]);
    expect(p.top).toBe(10);
    expect(p.right).toBe(20);
    expect(p.bottom).toBe(10);
    expect(p.left).toBe(20);
  });

  it("uses [t, r, b, l] as CSS order", () => {
    const p = resolvePadding([1, 2, 3, 4]);
    expect(p.top).toBe(1);
    expect(p.right).toBe(2);
    expect(p.bottom).toBe(3);
    expect(p.left).toBe(4);
  });
});

describe("mainAxisPaddingFrom / crossAxisPaddingFrom", () => {
  const pad = resolvePadding([10, 20, 30, 40]);

  it("vertical: main = top + bottom, cross = left + right", () => {
    expect(mainAxisPaddingFrom(pad, false)).toBe(40);
    expect(crossAxisPaddingFrom(pad, false)).toBe(60);
  });

  it("horizontal: main = left + right, cross = top + bottom", () => {
    expect(mainAxisPaddingFrom(pad, true)).toBe(60);
    expect(crossAxisPaddingFrom(pad, true)).toBe(40);
  });
});

// =============================================================================
// phase2Commit — Main Axis Transform Offsets
// =============================================================================

describe("phase2Commit padding", () => {
  it("adds startPadding to item translateY", () => {
    const state = makeState(20, 5);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 16, 0, 0, "", 0), HOOKS,
      null, null,
    );

    const el0 = rendered.get(0)!;
    const el1 = rendered.get(1)!;
    expect(el0.style.transform).toBe("translateY(16px)");
    expect(el1.style.transform).toBe("translateY(56px)");
  });

  it("no offset when startPadding is 0", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.transform).toBe("translateY(0px)");
    expect(rendered.get(1)!.style.transform).toBe("translateY(40px)");
  });

  it("horizontal: adds startPadding to translateX", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", true, 12, 0, 0, "", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.transform).toBe("translateX(12px)");
  });
});

// =============================================================================
// phase2Commit — Cross-Axis Inline Styles
// =============================================================================

describe("phase2Commit cross-axis padding", () => {
  it("sets inline left/right for vertical mode", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 8, 8, "", 0), HOOKS,
      null, null,
    );

    const el = rendered.get(0)!;
    expect(el.style.left).toBe("8px");
    expect(el.style.right).toBe("8px");
  });

  it("sets inline top/bottom for horizontal mode", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", true, 0, 10, 5, "", 0), HOOKS,
      null, null,
    );

    const el = rendered.get(0)!;
    expect(el.style.top).toBe("10px");
    expect(el.style.bottom).toBe("5px");
  });

  it("does not set cross-axis styles when padding is 0", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", 0), HOOKS,
      null, null,
    );

    const el = rendered.get(0)!;
    expect(el.style.left).toBe("");
    expect(el.style.right).toBe("");
  });

  it("restores cross-axis styles after release and re-acquire", () => {
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    // First render: items 0-2
    const state1 = makeState(20, 3);
    phase2Commit(
      state1, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 8, 12, 12, "", 0), HOOKS,
      null, null,
    );
    expect(rendered.get(0)!.style.left).toBe("12px");

    // Second render: items 5-7 (releases 0-2, acquires 5-7)
    const state2 = createEngineState(200);
    state2.totalItems = 20;
    state2.containerSize = 400;
    state2.visibleCount = 3;
    for (let i = 0; i < 3; i++) {
      state2.visibleIndices[i] = i + 5;
      state2.visibleOffsets[i] = (i + 5) * ITEM_SIZE;
      state2.visibleSizes[i] = ITEM_SIZE;
    }
    phase2Commit(
      state2, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 8, 12, 12, "", 0), HOOKS,
      null, null,
    );

    // Newly acquired elements should have cross-axis padding
    expect(rendered.get(5)!.style.left).toBe("12px");
    expect(rendered.get(5)!.style.right).toBe("12px");
  });
});

// =============================================================================
// phase1Calculate — Range Adjustment for startPadding
// =============================================================================

describe("phase1Calculate startPadding range adjustment", () => {
  it("renders items at the start when scrolled past startPadding", () => {
    const totalItems = 100;
    const sizeCache = createSizeCache(ITEM_SIZE, totalItems);
    const state = createEngineState(200);
    state.totalItems = totalItems;
    state.containerSize = 400;
    state.scrollPosition = 200;

    // With startPadding=100, item at offset 100 is visually at 200 (the scroll pos).
    // The range start should include items at offset >= 100.
    phase1Calculate(state, sizeCache, 3, HOOKS, 100);

    // Without padding adjustment, visStart would be index 5 (offset 200).
    // With adjustment, visStart should be index 2-3 (offset 100 area).
    const startIdx = state.visibleIndices[0]!;
    expect(startIdx).toBeLessThanOrEqual(2);
  });

  it("range start is 0 when padding exceeds scroll position", () => {
    const totalItems = 50;
    const sizeCache = createSizeCache(ITEM_SIZE, totalItems);
    const state = createEngineState(200);
    state.totalItems = totalItems;
    state.containerSize = 400;
    state.scrollPosition = 5;

    phase1Calculate(state, sizeCache, 3, HOOKS, 20);

    expect(state.visibleIndices[0]).toBe(0);
  });

  it("no adjustment when startPadding is 0", () => {
    const totalItems = 50;
    const sizeCache = createSizeCache(ITEM_SIZE, totalItems);

    const stateWithPad = createEngineState(200);
    stateWithPad.totalItems = totalItems;
    stateWithPad.containerSize = 400;
    stateWithPad.scrollPosition = 200;
    phase1Calculate(stateWithPad, sizeCache, 3, HOOKS, 0);

    const stateNoPad = createEngineState(200);
    stateNoPad.totalItems = totalItems;
    stateNoPad.containerSize = 400;
    stateNoPad.scrollPosition = 200;
    phase1Calculate(stateNoPad, sizeCache, 3, HOOKS);

    expect(stateWithPad.visibleIndices[0]).toBe(stateNoPad.visibleIndices[0]);
    expect(stateWithPad.visibleCount).toBe(stateNoPad.visibleCount);
  });
});

// =============================================================================
// Combined: main + cross padding in a single commit
// =============================================================================

describe("combined main + cross padding", () => {
  it("applies both axes simultaneously", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    // padding: 8 → startPadding=8, crossPadStart=8, crossPadEnd=8
    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 8, 8, 8, "", 0), HOOKS,
      null, null,
    );

    const el0 = rendered.get(0)!;
    const el2 = rendered.get(2)!;

    // Main axis: translateY(startPadding + offset)
    expect(el0.style.transform).toBe("translateY(8px)");
    expect(el2.style.transform).toBe("translateY(88px)");

    // Cross axis: inline left/right
    expect(el0.style.left).toBe("8px");
    expect(el0.style.right).toBe("8px");
  });

  it("handles asymmetric padding", () => {
    const state = makeState(20, 2);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    // padding: [10, 20, 30, 40] → startPad=10, crossPadStart=40, crossPadEnd=20
    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 10, 40, 20, "", 0), HOOKS,
      null, null,
    );

    const el = rendered.get(0)!;
    expect(el.style.transform).toBe("translateY(10px)");
    expect(el.style.left).toBe("40px");
    expect(el.style.right).toBe("20px");
  });
});

// =============================================================================
// Striped — oddClass toggle
// =============================================================================

describe("phase2Commit striped", () => {
  it("toggles odd class on odd-indexed items", () => {
    const state = makeState(20, 4);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "vlist-item--odd", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.classList.contains("vlist-item--odd")).toBe(false);
    expect(rendered.get(1)!.classList.contains("vlist-item--odd")).toBe(true);
    expect(rendered.get(2)!.classList.contains("vlist-item--odd")).toBe(false);
    expect(rendered.get(3)!.classList.contains("vlist-item--odd")).toBe(true);
  });

  it("does not add odd class when oddClass is empty", () => {
    const state = makeState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.classList.contains("vlist-item--odd")).toBe(false);
    expect(rendered.get(1)!.classList.contains("vlist-item--odd")).toBe(false);
  });

  it("updates odd class when items shift after release/acquire", () => {
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");
    const oddClass = "vlist-item--odd";

    // First render: items 0-2
    const state1 = makeState(20, 3);
    phase2Commit(
      state1, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, oddClass, 0), HOOKS,
      null, null,
    );
    expect(rendered.get(1)!.classList.contains(oddClass)).toBe(true);

    // Second render: items 3-5 (releases 0-2, acquires 3-5)
    const state2 = createEngineState(200);
    state2.totalItems = 20;
    state2.containerSize = 400;
    state2.visibleCount = 3;
    for (let i = 0; i < 3; i++) {
      state2.visibleIndices[i] = i + 3;
      state2.visibleOffsets[i] = (i + 3) * ITEM_SIZE;
      state2.visibleSizes[i] = ITEM_SIZE;
    }
    phase2Commit(
      state2, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, oddClass, 0), HOOKS,
      null, null,
    );

    expect(rendered.get(3)!.classList.contains(oddClass)).toBe(true);
    expect(rendered.get(4)!.classList.contains(oddClass)).toBe(false);
    expect(rendered.get(5)!.classList.contains(oddClass)).toBe(true);
  });

  it("works with custom classPrefix", () => {
    const state = makeState(20, 2);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("my");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("my", false, 0, 0, 0, "my-item--odd", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.classList.contains("my-item--odd")).toBe(false);
    expect(rendered.get(1)!.classList.contains("my-item--odd")).toBe(true);
  });
});
