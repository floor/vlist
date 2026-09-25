/**
 * vlist — Gap Tests
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
import type { VListPlugin } from "../../src/core/types";
import { groups } from "../../src/plugins/groups/plugin";
import { createVList } from "../../src/native";

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
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", GAP), HOOKS,
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
      () => items, rendered, createRenderConfig("vlist", true, 0, 0, 0, "", GAP), HOOKS,
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
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", 0), HOOKS,
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
      () => items, rendered, createRenderConfig("vlist", false, 0, 0, 0, "", GAP), HOOKS,
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

  // These two used to build the correction inside the test and then assert it,
  // so they could not fail on anything the library did. The cache takes the gap
  // now, and they assert the library instead.
  it("trailing gap: totalSize excludes the last gap", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 5, GAP);
    // 5 items × (40 + 12) = 260, minus one trailing gap = 248
    expect(cache.getTotalSize()).toBe(5 * (ITEM_SIZE + GAP) - GAP);
  });

  it("trailing gap: 0 items returns 0", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 0, GAP);
    expect(cache.getTotalSize()).toBe(0);
  });

  it("trailing gap: variable sizes drop one gap, not one per item", () => {
    const sizes = [30, 50, 70];
    const cache = createSizeCache((i: number) => (sizes[i] ?? 40) + GAP, 3, GAP);
    expect(cache.getTotalSize()).toBe(30 + 50 + 70 + 3 * GAP - GAP);
  });

  it("no gap argument: the total keeps every slot", () => {
    const cache = createSizeCache(ITEM_SIZE + GAP, 5);
    expect(cache.getTotalSize()).toBe(5 * (ITEM_SIZE + GAP));
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


// =============================================================================
// A plugin that replaces the size config must not lose the gap correction (C6)
// =============================================================================

describe("gap survives a size-config replacement (C6)", () => {
  it("groups keeps the trailing gap out of the total", () => {
    let total = -1;
    const probe: VListPlugin<TestItem> = {
      name: "gap-probe",
      priority: 99,
      setup(ctx) {
        total = ctx.sizes.cache.getTotalSize();
      },
    };

    const container = createContainer();
    const list = createVList<TestItem>(
      {
        container,
        items: createTestItems(10),
        item: { height: 50, gap: 10, template: simpleTemplate },
      },
      [
        groups({
          getGroupForIndex: (i: number) => (i < 5 ? "A" : "B"),
          header: { height: 30, template: (g: string) => g },
        }),
        probe,
      ],
    );

    // groups replaces the size config, which used to install a fresh cache over
    // the one core had wrapped, taking the trailing-gap correction with it and
    // leaving 630. The gap is a cache parameter now, so the replacement carries
    // it: one gap of empty space at the bottom, not two.
    expect(total).toBe(620);

    list.destroy();
    container.remove();
  });
});
