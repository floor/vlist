/**
 * vlist v2 — Selection + Groups Integration Tests
 *
 * Verifies selection behavior when group headers are present:
 * shift+click range selection skips headers, keyboard range selection
 * with Shift+Arrow across headers, and header-skip on focus navigation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { selection } from "../../../src/plugins/selection/plugin";
import type { VListItem } from "../../../src/types";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  __groupHeader?: boolean;
}

// Layout: [H0, I1, I2, I3, H4, I5, I6, I7, H8, I9]
// Headers at layout indices 0, 4, 8
// Data items at layout indices 1, 2, 3, 5, 6, 7, 9
function createGroupedItems(): TestItem[] {
  return [
    { id: 100, name: "Group A", __groupHeader: true },
    { id: 1, name: "Item 1" },
    { id: 2, name: "Item 2" },
    { id: 3, name: "Item 3" },
    { id: 200, name: "Group B", __groupHeader: true },
    { id: 5, name: "Item 5" },
    { id: 6, name: "Item 6" },
    { id: 7, name: "Item 7" },
    { id: 300, name: "Group C", __groupHeader: true },
    { id: 9, name: "Item 9" },
  ];
}

function setupWithGroups(mode: "single" | "multiple" = "multiple") {
  const items = createGroupedItems();
  const mockCtx = createPluginMockContext<TestItem>(items, {
    itemSize: 50,
    containerHeight: 500,
  });

  // Register group-awareness methods that the selection plugin resolves
  mockCtx.ctx.registerMethod("_isGroupHeader", (layoutIdx: number): boolean => {
    const item = items[layoutIdx];
    return item?.__groupHeader === true;
  });
  mockCtx.ctx.registerMethod("_layoutToDataIndex", (layoutIdx: number): number => layoutIdx);
  mockCtx.ctx.registerMethod("_dataToLayoutIndex", (dataIdx: number): number => dataIdx);

  const plugin = selection<TestItem>({ mode });
  plugin.setup(mockCtx.ctx);

  const getSelected = mockCtx.methods.get("getSelected") as () => Array<string | number>;

  return { plugin, mockCtx, items, getSelected };
}

function makeItemElement(index: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-index", String(index));
  return el;
}

function makeClickEvent(target: HTMLElement, opts?: { shiftKey?: boolean }): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    shiftKey: opts?.shiftKey ?? false,
  });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function makeKeyEvent(key: string, opts?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    shiftKey: opts?.shiftKey ?? false,
    ctrlKey: opts?.ctrlKey ?? false,
    metaKey: opts?.metaKey ?? false,
  });
  return event;
}

// =============================================================================
// Navigation skips group headers
// =============================================================================

describe("selection + groups — focus navigation skips headers", () => {
  it("ArrowDown skips group header at target index", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups("single");

    const handler = mockCtx.keydownHandlers[0]!;

    // ArrowDown from -1 → tries 0 (header) → skips to 1
    handler(makeKeyEvent("ArrowDown"));

    const getFocusedIndex = mockCtx.methods.get("_getFocusedIndex") as () => number;
    expect(getFocusedIndex()).toBe(1);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("ArrowDown from item 3 skips header at 4 to land on 5", () => {
    const { plugin, mockCtx } = setupWithGroups("single");

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 3: ArrowDown × 4 (→1, →2, →3)
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3
    handler(makeKeyEvent("ArrowDown")); // → tries 4 (header) → 5

    const getFocusedIndex = mockCtx.methods.get("_getFocusedIndex") as () => number;
    expect(getFocusedIndex()).toBe(5);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("ArrowUp from item 5 skips header at 4 to land on 3", () => {
    const { plugin, mockCtx } = setupWithGroups("single");

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 5
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3
    handler(makeKeyEvent("ArrowDown")); // → 5 (skip header 4)

    // Now ArrowUp from 5 → tries 4 (header) → 3
    handler(makeKeyEvent("ArrowUp"));

    const getFocusedIndex = mockCtx.methods.get("_getFocusedIndex") as () => number;
    expect(getFocusedIndex()).toBe(3);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Shift+click range selection with group headers
// =============================================================================

describe("selection + groups — shift+click range selection", () => {
  it("shift+click range skips group headers", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.clickHandlers[0]!;

    // Click item at layout index 1 (id=1)
    handler(makeClickEvent(makeItemElement(1)));
    expect(getSelected()).toEqual([1]);

    // Shift+click item at layout index 6 (id=6) — range 1..6
    handler(makeClickEvent(makeItemElement(6), { shiftKey: true }));

    const selected = getSelected();
    // Layout range 1..6: id=1, id=2, id=3, header(idx=4), id=5, id=6
    // Group headers are skipped — only data items selected
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(5);
    expect(selected).toContain(6);
    expect(selected).not.toContain(200);
    expect(selected.length).toBe(5);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("shift+click backward range works correctly", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.clickHandlers[0]!;

    // Click item at layout index 7 (id=7)
    handler(makeClickEvent(makeItemElement(7)));

    // Shift+click item at layout index 2 (id=2) — backward range
    handler(makeClickEvent(makeItemElement(2), { shiftKey: true }));

    const selected = getSelected();
    // Layout range 2..7: id=2, id=3, header(idx=4), id=5, id=6, id=7
    // Group headers skipped
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(5);
    expect(selected).toContain(6);
    expect(selected).toContain(7);
    expect(selected).not.toContain(200);
    expect(selected.length).toBe(5);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Shift+Arrow keyboard range selection with headers
// =============================================================================

describe("selection + groups — shift+arrow range selection", () => {
  it("Shift+ArrowDown toggles selection on destination, skipping header", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 3
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3

    // Select current item to establish anchor
    handler(makeKeyEvent(" ")); // select item at 3
    expect(getSelected()).toContain(3);

    // Shift+ArrowDown → skips header 4, lands on 5, toggles item at 5
    handler(makeKeyEvent("ArrowDown", { shiftKey: true }));

    const selected = getSelected();
    expect(selected).toContain(3);
    expect(selected).toContain(5);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("Shift+ArrowUp toggles selection on destination, skipping header", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 5
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3
    handler(makeKeyEvent("ArrowDown")); // → 5 (skips header 4)

    // Select current item
    handler(makeKeyEvent(" ")); // select item at 5

    // Shift+ArrowUp → skips header 4, lands on 3, toggles item at 3
    handler(makeKeyEvent("ArrowUp", { shiftKey: true }));

    const selected = getSelected();
    expect(selected).toContain(5);
    expect(selected).toContain(3);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Ctrl+Shift+Home/End range selection
// =============================================================================

describe("selection + groups — Ctrl+Shift+Home/End", () => {
  it("Ctrl+Shift+End selects from current to end", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 5
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3
    handler(makeKeyEvent("ArrowDown")); // → 5

    // Ctrl+Shift+End → range from 5 to 9 (end, skipping header)
    handler(makeKeyEvent("End", { shiftKey: true, ctrlKey: true }));

    const selected = getSelected();
    // Range from focus (5) to end focus (9, skipping header 8)
    // doSelectRange covers data indices from prevFocus to new focus
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected).toContain(5);
    expect(selected).toContain(9);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("Ctrl+Shift+Home selects from current to beginning", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.keydownHandlers[0]!;

    // Navigate to item 7
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3
    handler(makeKeyEvent("ArrowDown")); // → 5
    handler(makeKeyEvent("ArrowDown")); // → 6
    handler(makeKeyEvent("ArrowDown")); // → 7

    // Ctrl+Shift+Home → range from 7 to 0 (Home, skipping header)
    handler(makeKeyEvent("Home", { shiftKey: true, ctrlKey: true }));

    const selected = getSelected();
    // Focus goes to 0 → skipHeaders → 1
    // doSelectRange from prevFocus (7) to new focus (1)
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected).toContain(1);
    expect(selected).toContain(7);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Space does not select group headers
// =============================================================================

describe("selection + groups — Space skips headers", () => {
  it("navigating to a header and pressing Space does not select header", () => {
    const { plugin, mockCtx, getSelected } = setupWithGroups();

    const handler = mockCtx.keydownHandlers[0]!;

    // First ArrowDown skips header at 0, lands on 1
    handler(makeKeyEvent("ArrowDown"));

    // Navigate to 1 and check Space selects it
    handler(makeKeyEvent(" "));
    expect(getSelected()).toContain(1);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// followFocus=false: focus-selection desync
// =============================================================================

describe("selection + groups — followFocus=false desync", () => {
  it("navigation without shift does not change selection", () => {
    const items = createGroupedItems();
    const mockCtx = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 500,
    });

    mockCtx.ctx.registerMethod("_isGroupHeader", (i: number): boolean =>
      items[i]?.__groupHeader === true);
    mockCtx.ctx.registerMethod("_layoutToDataIndex", (i: number): number => i);
    mockCtx.ctx.registerMethod("_dataToLayoutIndex", (i: number): number => i);

    const plugin = selection<TestItem>({ mode: "multiple", followFocus: false });
    plugin.setup(mockCtx.ctx);

    const handler = mockCtx.keydownHandlers[0]!;
    const getSelected = mockCtx.methods.get("getSelected") as () => Array<string | number>;

    // Navigate to 1, select it
    handler(makeKeyEvent("ArrowDown")); // → 1
    handler(makeKeyEvent(" ")); // select 1
    expect(getSelected()).toContain(1);

    // Navigate away without shift
    handler(makeKeyEvent("ArrowDown")); // → 2
    handler(makeKeyEvent("ArrowDown")); // → 3

    // Selection unchanged — only item 1 selected
    expect(getSelected()).toEqual([1]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("followFocus=true in single mode auto-selects on navigation", () => {
    const items = createGroupedItems();
    const mockCtx = createPluginMockContext<TestItem>(items, {
      itemSize: 50,
      containerHeight: 500,
    });

    mockCtx.ctx.registerMethod("_isGroupHeader", (i: number): boolean =>
      items[i]?.__groupHeader === true);
    mockCtx.ctx.registerMethod("_layoutToDataIndex", (i: number): number => i);
    mockCtx.ctx.registerMethod("_dataToLayoutIndex", (i: number): number => i);

    const plugin = selection<TestItem>({ mode: "single", followFocus: true });
    plugin.setup(mockCtx.ctx);

    const handler = mockCtx.keydownHandlers[0]!;
    const getSelected = mockCtx.methods.get("getSelected") as () => Array<string | number>;

    handler(makeKeyEvent("ArrowDown")); // → 1, auto-selects
    expect(getSelected()).toContain(1);

    handler(makeKeyEvent("ArrowDown")); // → 2, auto-selects (replaces 1)
    expect(getSelected()).toEqual([2]);
    expect(getSelected()).not.toContain(1);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Click selects correct item with layout/data index offset
// =============================================================================

describe("selection + groups — click with layout/data offset", () => {
  // When groups are active, layout indices include headers so they diverge
  // from data indices. The items array only contains DATA items (no headers).
  // Headers are virtual — _isGroupHeader tells the selection plugin which
  // layout indices are headers.
  //
  //   Layout: [H0, D0(1), D1(2), D2(3), H1(4), D3(5), D4(6), D5(7)]
  //   Data:   [Alpha(0), Beta(1), Gamma(2), Delta(3), Epsilon(4), Zeta(5)]
  //   layoutToData(1)=0, layoutToData(5)=3, layoutToData(6)=4
  function setupWithRealOffset(mode: "single" | "multiple" = "single") {
    const dataItems: TestItem[] = [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
      { id: 4, name: "Delta" },
      { id: 5, name: "Epsilon" },
      { id: 6, name: "Zeta" },
    ];

    // Layout has 8 entries (6 data + 2 headers) but ctx.getItems() returns
    // only the 6 data items — headers are virtual.
    const mockCtx = createPluginMockContext<TestItem>(dataItems, {
      itemSize: 40,
      containerHeight: 500,
    });
    // engineState.totalItems must reflect layout count (data + headers)
    mockCtx.engineState.totalItems = 8;

    mockCtx.ctx.registerMethod("_isGroupHeader", (layoutIdx: number): boolean =>
      layoutIdx === 0 || layoutIdx === 4);

    mockCtx.ctx.registerMethod("_layoutToDataIndex", (layoutIdx: number): number => {
      if (layoutIdx === 0 || layoutIdx === 4) return -1;
      return layoutIdx < 4 ? layoutIdx - 1 : layoutIdx - 2;
    });
    mockCtx.ctx.registerMethod("_dataToLayoutIndex", (dataIdx: number): number => {
      return dataIdx < 3 ? dataIdx + 1 : dataIdx + 2;
    });

    const plugin = selection<TestItem>({ mode });
    plugin.setup(mockCtx.ctx);

    const getSelected = mockCtx.methods.get("getSelected") as () => Array<string | number>;

    return { plugin, mockCtx, dataItems, getSelected };
  }

  it("click on first group item selects correct item", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(1)));
    expect(getSelected()).toEqual([1]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("click on second group item selects correct item", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(5)));
    expect(getSelected()).toEqual([4]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("click after two headers selects correct item (offset=2)", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(7)));
    expect(getSelected()).toEqual([6]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("click on group header does not select", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(0)));
    expect(getSelected()).toEqual([]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("click on header between groups does not select", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(4)));
    expect(getSelected()).toEqual([]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("sequential clicks across groups select correct items", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(2)));
    expect(getSelected()).toEqual([2]);

    handler(makeClickEvent(makeItemElement(6)));
    expect(getSelected()).toEqual([5]);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("itemStateFn marks correct item as selected with offset", () => {
    const { plugin, mockCtx } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(3)));

    const stateFn = mockCtx.ctx.getItemStateFn();
    expect(stateFn).not.toBeNull();

    const state3 = { selected: false, focused: false };
    stateFn!(3, state3);
    expect(state3.selected).toBe(true);

    const state2 = { selected: false, focused: false };
    stateFn!(2, state2);
    expect(state2.selected).toBe(false);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("shift+click range with offset skips headers", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset("multiple");
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(1)));
    handler(makeClickEvent(makeItemElement(6), { shiftKey: true }));

    const selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected).not.toContain(100);
    expect(selected).not.toContain(200);
    expect(selected.length).toBe(5);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("getSelectedItems returns correct item after click with offset", () => {
    const { plugin, mockCtx } = setupWithRealOffset();
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(5)));

    const getSelectedItems = mockCtx.methods.get("getSelectedItems") as () => any[];
    const items = getSelectedItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(4);
    expect(items[0].name).toBe("Delta");

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("focus:change event reports correct item with offset", () => {
    const { plugin, mockCtx } = setupWithRealOffset();
    const keyHandler = mockCtx.keydownHandlers[0]!;
    const getSelectedItems = mockCtx.methods.get("getSelectedItems") as () => any[];
    const getFocused = mockCtx.methods.get("_getFocusedIndex") as () => number;

    // ArrowDown from -1 → skips header 0 → layout 1 (data 0, id=1)
    keyHandler(makeKeyEvent("ArrowDown"));
    expect(getFocused()).toBe(1);

    // ArrowDown across header → layout 5 via 2→3→5
    keyHandler(makeKeyEvent("ArrowDown")); // → 2
    keyHandler(makeKeyEvent("ArrowDown")); // → 3
    keyHandler(makeKeyEvent("ArrowDown")); // → 5 (skip header 4)
    expect(getFocused()).toBe(5);

    // Select via Space, verify correct item
    keyHandler(makeKeyEvent(" "));
    const items = getSelectedItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(4);
    expect(items[0].name).toBe("Delta");

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("selectAll skips headers and selects only data items", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset("multiple");

    (mockCtx.methods.get("selectAll") as () => void)();

    const selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected).toContain(6);
    expect(selected.length).toBe(6);

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("getSelectedItems returns correct items after click with offset", () => {
    const { plugin, mockCtx } = setupWithRealOffset("multiple");
    const handler = mockCtx.clickHandlers[0]!;

    handler(makeClickEvent(makeItemElement(6)));

    const getSelectedItems = mockCtx.methods.get("getSelectedItems") as () => any[];
    const items = getSelectedItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(5);
    expect(items[0].name).toBe("Epsilon");

    plugin.destroy!();
    mockCtx.cleanup();
  });

  it("keyboard Space selects correct item with offset", () => {
    const { plugin, mockCtx, getSelected } = setupWithRealOffset("multiple");
    const keyHandler = mockCtx.keydownHandlers[0]!;

    keyHandler(makeKeyEvent("ArrowDown"));
    keyHandler(makeKeyEvent("ArrowDown"));
    keyHandler(makeKeyEvent("ArrowDown"));
    keyHandler(makeKeyEvent("ArrowDown"));

    keyHandler(makeKeyEvent(" "));

    const selected = getSelected();
    expect(selected).toEqual([4]);

    plugin.destroy!();
    mockCtx.cleanup();
  });
});
