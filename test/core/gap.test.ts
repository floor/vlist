/**
 * vlist v2 — Gap Tests
 *
 * Tests item gap support: size cache bakes gap into slot sizes,
 * pipeline subtracts gap for DOM element sizing, trailing gap
 * is removed from total size, and autosize inherits gap from config.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createEngineState } from "../../src/core/state";
import { phase1Calculate, phase2Commit, createRenderConfig } from "../../src/core/pipeline";
import { createPool } from "../../src/core/pool";
import { compileHooks } from "../../src/core/hooks";
import { createSizeCache } from "../../src/core/sizes";
import { createVList } from "../../src/core/create";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

const ITEM_SIZE = 40;
const GAP = 12;
const HOOKS = compileHooks([]);

function makeGapState(totalItems: number, count: number): ReturnType<typeof createEngineState> {
  const slotSize = ITEM_SIZE + GAP;
  const state = createEngineState(200);
  state.totalItems = totalItems;
  state.containerSize = 400;
  state.scrollPosition = 0;
  state.visibleCount = count;
  for (let i = 0; i < count; i++) {
    state.visibleIndices[i] = i;
    state.visibleOffsets[i] = i * slotSize;
    state.visibleSizes[i] = slotSize;
  }
  return state;
}

// =============================================================================
// phase2Commit — Gap subtracted from DOM element sizes
// =============================================================================

describe("phase2Commit gap", () => {
  it("subtracts gap from element height (vertical)", () => {
    const state = makeGapState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, true, 0, 0, 0, "", GAP), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.height).toBe(`${ITEM_SIZE}px`);
    expect(rendered.get(1)!.style.height).toBe(`${ITEM_SIZE}px`);
    expect(rendered.get(2)!.style.height).toBe(`${ITEM_SIZE}px`);
  });

  it("subtracts gap from element width (horizontal)", () => {
    const state = makeGapState(20, 2);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", true, true, 0, 0, 0, "", GAP), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.width).toBe(`${ITEM_SIZE}px`);
    expect(rendered.get(1)!.style.width).toBe(`${ITEM_SIZE}px`);
  });

  it("no subtraction when gap is 0", () => {
    const state = createEngineState(200);
    state.totalItems = 20;
    state.containerSize = 400;
    state.visibleCount = 2;
    for (let i = 0; i < 2; i++) {
      state.visibleIndices[i] = i;
      state.visibleOffsets[i] = i * ITEM_SIZE;
      state.visibleSizes[i] = ITEM_SIZE;
    }

    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, true, 0, 0, 0, "", 0), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.height).toBe(`${ITEM_SIZE}px`);
  });

  it("offsets are spaced by itemSize + gap", () => {
    const state = makeGapState(20, 3);
    const items = createTestItems(20);
    const rendered = new Map<number, HTMLElement>();
    const content = document.createElement("div");
    const pool = createPool("vlist");

    phase2Commit(
      state, pool, content, simpleTemplate as any,
      () => items, rendered, createRenderConfig("vlist", false, true, 0, 0, 0, "", GAP), HOOKS,
      null, null,
    );

    expect(rendered.get(0)!.style.transform).toBe("translateY(0px)");
    expect(rendered.get(1)!.style.transform).toBe(`translateY(${ITEM_SIZE + GAP}px)`);
    expect(rendered.get(2)!.style.transform).toBe(`translateY(${2 * (ITEM_SIZE + GAP)}px)`);
  });
});

// =============================================================================
// Size Cache — gap baked into slot sizes
// =============================================================================

describe("size cache with gap", () => {
  it("fixed size: slot = itemSize + gap", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 10);
    expect(cache.getSize(0)).toBe(ITEM_SIZE + GAP);
    expect(cache.getOffset(1)).toBe(ITEM_SIZE + GAP);
    expect(cache.getOffset(2)).toBe(2 * (ITEM_SIZE + GAP));
  });

  it("variable size: slot = sizeFn(i) + gap", () => {
    const sizes = [30, 50, 70];
    const cache = createSizeCache((i: number) => (sizes[i] ?? 40) + GAP, 3);

    expect(cache.getSize(0)).toBe(30 + GAP);
    expect(cache.getSize(1)).toBe(50 + GAP);
    expect(cache.getSize(2)).toBe(70 + GAP);
    expect(cache.getOffset(1)).toBe(30 + GAP);
    expect(cache.getOffset(2)).toBe(30 + GAP + 50 + GAP);
  });

  it("trailing gap fix: totalSize excludes last gap", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 5);
    const orig = cache.getTotalSize;
    cache.getTotalSize = () => {
      const t = orig();
      return t > 0 ? t - GAP : 0;
    };

    // 5 items × (40 + 12) = 260, minus trailing gap = 248
    expect(cache.getTotalSize()).toBe(5 * (ITEM_SIZE + GAP) - GAP);
  });

  it("trailing gap fix: 0 items returns 0", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 0);
    const orig = cache.getTotalSize;
    cache.getTotalSize = () => {
      const t = orig();
      return t > 0 ? t - GAP : 0;
    };

    expect(cache.getTotalSize()).toBe(0);
  });
});

// =============================================================================
// createVList integration — gap wiring
// =============================================================================

function getContent(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".vlist-content");
  if (!el) throw new Error("vlist-content not found");
  return el;
}

describe("createVList with gap", () => {
  it("content size excludes trailing gap (fixed)", () => {
    const container = createContainer();
    const count = 5;
    const items = createTestItems(count);
    const list = createVList<TestItem>({
      container,
      items,
      item: { height: ITEM_SIZE, gap: GAP, template: simpleTemplate },
    });

    const content = getContent(container);
    const expectedTotal = count * (ITEM_SIZE + GAP) - GAP;
    expect(content.style.height).toBe(`${expectedTotal}px`);

    list.destroy();
  });

  it("content size excludes trailing gap (variable)", () => {
    const container = createContainer();
    const heights = [30, 50, 70];
    const items = createTestItems(3);
    const list = createVList<TestItem>({
      container,
      items,
      item: {
        height: (i: number) => heights[i] ?? 40,
        gap: GAP,
        template: simpleTemplate,
      },
    });

    const content = getContent(container);
    const expectedTotal = (30 + GAP) + (50 + GAP) + (70 + GAP) - GAP;
    expect(content.style.height).toBe(`${expectedTotal}px`);

    list.destroy();
  });

  it("gap 0 has no effect on content size", () => {
    const container = createContainer();
    const items = createTestItems(5);
    const list = createVList<TestItem>({
      container,
      items,
      item: { height: ITEM_SIZE, gap: 0, template: simpleTemplate },
    });

    const content = getContent(container);
    expect(content.style.height).toBe(`${5 * ITEM_SIZE}px`);

    list.destroy();
  });

  it("setItems recalculates with gap", () => {
    const container = createContainer();
    const items = createTestItems(5);
    const list = createVList<TestItem>({
      container,
      items,
      item: { height: ITEM_SIZE, gap: GAP, template: simpleTemplate },
    });

    const content = getContent(container);
    list.setItems(createTestItems(3));

    const expectedTotal = 3 * (ITEM_SIZE + GAP) - GAP;
    expect(content.style.height).toBe(`${expectedTotal}px`);

    list.destroy();
  });

  it("appendItems preserves gap in content size", () => {
    const container = createContainer();
    const items = createTestItems(3);
    const list = createVList<TestItem>({
      container,
      items,
      item: { height: ITEM_SIZE, gap: GAP, template: simpleTemplate },
    });

    const content = getContent(container);
    list.appendItems(createTestItems(2, 100));

    const expectedTotal = 5 * (ITEM_SIZE + GAP) - GAP;
    expect(content.style.height).toBe(`${expectedTotal}px`);

    list.destroy();
  });

  it("empty list has content size 0 with gap", () => {
    const container = createContainer();
    const list = createVList<TestItem>({
      container,
      items: [],
      item: { height: ITEM_SIZE, gap: GAP, template: simpleTemplate },
    });

    const content = getContent(container);
    expect(content.style.height).toBe("0px");

    list.destroy();
  });
});
