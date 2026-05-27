/**
 * vlist v2 — Template Error Handling Tests
 *
 * Verifies that template() errors in the render pipeline are caught,
 * emitted as error events, and do not crash the render cycle.
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import {
  phase1Calculate,
  phase2Commit,
  createRenderConfig,
} from "../../src/core/pipeline";
import { createEngineState } from "../../src/core/state";
import { createSizeCache } from "../../src/core/sizes";
import { createPool } from "../../src/core/pool";
import { compileHooks } from "../../src/core/hooks";
import { createEmitter } from "../../src/events";
import type { VListEvents } from "../../src/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

function makeState(totalItems: number, visibleCount: number): ReturnType<typeof createEngineState> {
  const state = createEngineState(20);
  state.totalItems = totalItems;
  state.containerSize = 500;
  state.visibleCount = visibleCount;
  for (let i = 0; i < visibleCount; i++) {
    state.visibleIndices[i] = i;
    state.visibleOffsets[i] = i * 40;
    state.visibleSizes[i] = 40;
  }
  return state;
}

// =============================================================================
// Phase2Commit — template error on new element creation
// =============================================================================

describe("phase2Commit — template error on new element (acquire path)", () => {
  it("should not crash when template throws on a specific item", () => {
    const state = makeState(5, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    const items = createTestItems(5);

    const throwOnIndex2 = (item: TestItem, index: number): string => {
      if (index === 2) throw new Error("template boom");
      return `<div>${item.name}</div>`;
    };

    expect(() => {
      phase2Commit(state, pool, content, throwOnIndex2, () => items, rendered, rc, hooks);
    }).not.toThrow();
  });

  it("should render other items correctly when one template throws", () => {
    const state = makeState(5, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    const items = createTestItems(5);

    const throwOnIndex2 = (item: TestItem, index: number): string => {
      if (index === 2) throw new Error("template boom");
      return `<div>${item.name}</div>`;
    };

    phase2Commit(state, pool, content, throwOnIndex2, () => items, rendered, rc, hooks);

    // Index 2 should be skipped, others should render
    expect(rendered.has(0)).toBe(true);
    expect(rendered.has(1)).toBe(true);
    expect(rendered.has(2)).toBe(false);
    expect(rendered.has(3)).toBe(true);
    expect(rendered.has(4)).toBe(true);
    expect(rendered.size).toBe(4);
  });

  it("should emit error event with correct context including the index", () => {
    const state = makeState(5, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    const items = createTestItems(5);

    const errors: Array<{ error: Error; context: string }> = [];
    emitter.on("error", (evt) => { errors.push(evt); });

    const throwOnIndex3 = (item: TestItem, index: number): string => {
      if (index === 3) throw new Error("bad template");
      return `<div>${item.name}</div>`;
    };

    phase2Commit(state, pool, content, throwOnIndex3, () => items, rendered, rc, hooks);

    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toBe("template:render:3");
    expect(errors[0]!.error).toBeInstanceOf(Error);
    expect(errors[0]!.error.message).toBe("bad template");
  });

  it("should emit error with wrapped message when template throws a non-Error", () => {
    const state = makeState(3, 3);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    const items = createTestItems(3);

    const errors: Array<{ error: Error; context: string }> = [];
    emitter.on("error", (evt) => { errors.push(evt); });

    const throwString = (_item: TestItem, index: number): string => {
      if (index === 1) throw "string error";
      return `<div>ok</div>`;
    };

    phase2Commit(state, pool, content, throwString, () => items, rendered, rc, hooks);

    expect(errors.length).toBe(1);
    expect(errors[0]!.error).toBeInstanceOf(Error);
    expect(errors[0]!.error.message).toBe("string error");
    expect(errors[0]!.context).toBe("template:render:1");
  });

  it("should not emit error when emitter is null", () => {
    const state = makeState(3, 3);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    // No emitter passed — defaults to null
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0);
    const items = createTestItems(3);

    const throwOnIndex0 = (_item: TestItem, index: number): string => {
      if (index === 0) throw new Error("boom");
      return `<div>ok</div>`;
    };

    // Should not crash even without an emitter
    expect(() => {
      phase2Commit(state, pool, content, throwOnIndex0, () => items, rendered, rc, hooks);
    }).not.toThrow();

    // Item at index 0 skipped, others rendered
    expect(rendered.has(0)).toBe(false);
    expect(rendered.has(1)).toBe(true);
    expect(rendered.has(2)).toBe(true);
  });
});

// =============================================================================
// Phase2Commit — template error on element reuse (update path)
// =============================================================================

describe("phase2Commit — template error on re-render (update path)", () => {
  it("should not crash when template throws on update", () => {
    const state = makeState(5, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    let items = createTestItems(5);

    // First render succeeds for all items
    phase2Commit(state, pool, content, simpleTemplate, () => items, rendered, rc, hooks);
    expect(rendered.size).toBe(5);

    // Replace items with new object references to trigger the update path
    items = items.map((item) => ({ ...item, name: `Updated ${item.id}` }));

    let throwCount = 0;
    const throwOnIndex2Update = (item: TestItem, index: number): string => {
      if (index === 2) {
        throwCount++;
        throw new Error("update boom");
      }
      return `<div>${item.name}</div>`;
    };

    const errors: Array<{ error: Error; context: string }> = [];
    emitter.on("error", (evt) => { errors.push(evt); });

    // Re-render with new items — should not crash
    state.renderPending = true;
    phase1Calculate(state, createSizeCache(40, 5), 2, hooks);
    phase2Commit(state, pool, content, throwOnIndex2Update, () => items, rendered, rc, hooks);

    expect(throwCount).toBe(1);
    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toBe("template:render:2");

    // Element at index 2 should still exist in rendered (it was already there),
    // but its content should NOT have been updated (the template threw)
    expect(rendered.has(2)).toBe(true);
    const el2 = rendered.get(2)!;
    // Content should still be the old value from simpleTemplate
    expect(el2.innerHTML).toContain("Item 3");
  });

  it("counter-based template: first render succeeds, throws on second render — remaining items still update", () => {
    const state = makeState(5, 5);
    const pool = createPool("vlist");
    const content = document.createElement("div");
    const rendered = new Map<number, HTMLElement>();
    const hooks = compileHooks([]);
    const emitter = createEmitter<VListEvents>();
    const rc = createRenderConfig("vlist", false, false, 0, 0, 0, "", 0, emitter);
    let items = createTestItems(5);

    const callCounts = new Map<number, number>();
    const counterTemplate = (item: TestItem, index: number): string => {
      const count = (callCounts.get(index) ?? 0) + 1;
      callCounts.set(index, count);
      // Throw on second call for index 1
      if (index === 1 && count === 2) {
        throw new Error("second call boom");
      }
      return `<div>${item.name} (render ${count})</div>`;
    };

    // First render — all succeed
    phase2Commit(state, pool, content, counterTemplate, () => items, rendered, rc, hooks);
    expect(rendered.size).toBe(5);
    expect(rendered.get(1)!.innerHTML).toContain("render 1");

    // Replace items to trigger updates
    items = items.map((item) => ({ ...item, name: `V2 ${item.id}` }));

    const errors: Array<{ error: Error; context: string }> = [];
    emitter.on("error", (evt) => { errors.push(evt); });

    state.renderPending = true;
    phase1Calculate(state, createSizeCache(40, 5), 2, hooks);
    phase2Commit(state, pool, content, counterTemplate, () => items, rendered, rc, hooks);

    // Index 1 threw on second render
    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toBe("template:render:1");

    // Index 1 content should be unchanged (old render)
    expect(rendered.get(1)!.innerHTML).toContain("render 1");

    // Other items should have been updated successfully
    expect(rendered.get(0)!.innerHTML).toContain("render 2");
    expect(rendered.get(2)!.innerHTML).toContain("render 2");
    expect(rendered.get(3)!.innerHTML).toContain("render 2");
    expect(rendered.get(4)!.innerHTML).toContain("render 2");
  });
});

// =============================================================================
// Full createVList integration — template errors
// =============================================================================

describe("createVList — template error handling", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
    list = null;
  });
  afterEach(() => {
    list?.destroy();
    container.remove();
  });

  it("template that throws on specific item does not crash the list", () => {
    const throwOnId3 = (item: TestItem, index: number): string => {
      if (item.id === 3) throw new Error("id 3 boom");
      return `<div>${item.name}</div>`;
    };

    expect(() => {
      list = createVList(
        { container, items: createTestItems(10), item: { height: 40, template: throwOnId3 } },
        [],
      );
    }).not.toThrow();

    expect(list!.total).toBe(10);
  });

  it("error event is emitted with correct context via createVList", () => {
    const throwOnId5 = (item: TestItem, _index: number): string => {
      if (item.id === 5) throw new Error("id 5 boom");
      return `<div>${item.name}</div>`;
    };

    list = createVList(
      { container, items: createTestItems(20), item: { height: 40, template: throwOnId5 } },
      [],
    );

    const errors: Array<{ error: Error; context: string }> = [];
    list.on("error", (evt) => { errors.push(evt); });

    // Force a re-render to trigger the error event through the emitter
    // (the initial render also fires, but we subscribed after)
    list.setItems(createTestItems(20));

    expect(errors.length).toBe(1);
    // Item with id 5 is at index 4 (0-based)
    expect(errors[0]!.context).toBe("template:render:4");
    expect(errors[0]!.error.message).toBe("id 5 boom");
  });

  it("template throwing on setItems update path does not crash", () => {
    let shouldThrow = false;

    const conditionalThrow = (item: TestItem, _index: number): string => {
      if (shouldThrow && item.id === 2) throw new Error("update boom");
      return `<div>${item.name}</div>`;
    };

    list = createVList(
      { container, items: createTestItems(10), item: { height: 40, template: conditionalThrow } },
      [],
    );

    const errors: Array<{ error: Error; context: string }> = [];
    list.on("error", (evt) => { errors.push(evt); });

    // Now enable the throw and update items
    shouldThrow = true;
    expect(() => {
      list!.setItems(createTestItems(10, 1).map((item) => ({ ...item, name: `New ${item.id}` })));
    }).not.toThrow();

    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toBe("template:render:1");
  });
});
