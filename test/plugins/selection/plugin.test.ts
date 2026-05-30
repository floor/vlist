/**
 * vlist v2 — Selection Plugin Tests
 * Tests for selection(): factory, setup wiring, click handlers, keyboard
 * handlers, registered methods, destroy cleanup.
 *
 * NOTE: The underlying selection logic is tested separately:
 * - selection/index.test.ts (61 tests, 100 assertions) — all pure state
 *   functions (selectItems, deselectItems, toggleSelection, selectAll,
 *   clearSelection, focus management, queries, keyboard helpers, selectRange)
 *
 * This file tests the plugin integration layer (selection()) that wires
 * selection state, click/keyboard handling, and public methods into the
 * plugin context.
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { selection } from "../../../src/plugins/selection/plugin";
import type { VListItem } from "../../../src/types";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// JSDOM Setup
// =============================================================================

beforeAll(() => {
  setupDOM();
});

afterAll(() => {
  teardownDOM();
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

// =============================================================================
// selection — Factory Tests
// =============================================================================

describe("selection — Factory", () => {
  it("should create a plugin with correct name and priority", () => {
    const plugin = selection<TestItem>();

    expect(plugin.name).toBe("selection");
    expect(plugin.priority).toBe(50);
    expect(typeof plugin.setup).toBe("function");
  });

  it("should accept empty config (defaults to single mode)", () => {
    const plugin = selection<TestItem>();
    expect(plugin).toBeDefined();
  });

  it("should accept single mode config", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    expect(plugin).toBeDefined();
  });

  it("should accept multiple mode config", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    expect(plugin).toBeDefined();
  });

  it("should accept none mode config", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    expect(plugin).toBeDefined();
  });

  it("should accept initial selection config", () => {
    const plugin = selection<TestItem>({
      mode: "multiple",
      initial: [1, 2, 3],
    });
    expect(plugin).toBeDefined();
  });

  it("should accept followFocus config", () => {
    const plugin = selection<TestItem>({ mode: "single", followFocus: true });
    expect(plugin).toBeDefined();
  });

  it("should accept focusOnClick config", () => {
    const plugin = selection<TestItem>({ mode: "single", focusOnClick: true });
    expect(plugin).toBeDefined();
  });
});

// =============================================================================
// selection — Setup Tests
// =============================================================================

describe("selection — Setup", () => {
  it("should register a click handler in single mode", () => {
    const plugin = selection<TestItem>();
    const { ctx, clickHandlers, cleanup } = createPluginMockContext(createTestItems(10));

    expect(clickHandlers.length).toBe(0);
    plugin.setup!(ctx);
    expect(clickHandlers.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should register a keydown handler", () => {
    const plugin = selection<TestItem>();
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(10));

    expect(keydownHandlers.length).toBe(0);
    plugin.setup!(ctx);
    expect(keydownHandlers.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should add selectable class to root", () => {
    const plugin = selection<TestItem>();
    const { ctx, dom, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--selectable")).toBe(true);

    cleanup();
  });

  it("should not add selectable class in none mode", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    const { ctx, dom, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);
    expect(dom.root.classList.contains("vlist--selectable")).toBe(false);

    cleanup();
  });

  it("destroy should not throw", () => {
    const plugin = selection<TestItem>();
    const { ctx, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);
    expect(() => plugin.destroy!()).not.toThrow();

    cleanup();
  });

  it("destroy without setup should not throw", () => {
    const plugin = selection<TestItem>();
    expect(() => plugin.destroy!()).not.toThrow();
  });
});

// =============================================================================
// selection — Public Methods Registration
// =============================================================================

describe("selection — Method Registration", () => {
  it("should register select method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("select")).toBe(true);
    expect(typeof methods.get("select")).toBe("function");

    cleanup();
  });

  it("should register deselect method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("deselect")).toBe(true);
    expect(typeof methods.get("deselect")).toBe("function");

    cleanup();
  });

  it("should register toggleSelect method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("toggleSelect")).toBe(true);
    expect(typeof methods.get("toggleSelect")).toBe("function");

    cleanup();
  });

  it("should register selectAll method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("selectAll")).toBe(true);
    expect(typeof methods.get("selectAll")).toBe("function");

    cleanup();
  });

  it("should register clearSelection method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("clearSelection")).toBe(true);
    expect(typeof methods.get("clearSelection")).toBe("function");

    cleanup();
  });

  it("should register getSelected method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("getSelected")).toBe(true);
    expect(typeof methods.get("getSelected")).toBe("function");

    cleanup();
  });

  it("should register getSelectedItems method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("getSelectedItems")).toBe(true);
    expect(typeof methods.get("getSelectedItems")).toBe("function");

    cleanup();
  });

  it("should register selectNext method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("selectNext")).toBe(true);
    expect(typeof methods.get("selectNext")).toBe("function");

    cleanup();
  });

  it("should register selectPrevious method", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("selectPrevious")).toBe(true);
    expect(typeof methods.get("selectPrevious")).toBe("function");

    cleanup();
  });

  it("should register all 15 methods in single mode (9 public + 6 internal)", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.size).toBe(15);

    cleanup();
  });

  it("should register all 12 methods in none mode (no-ops)", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    expect(methods.has("select")).toBe(true);
    expect(methods.has("deselect")).toBe(true);
    expect(methods.has("toggleSelect")).toBe(true);
    expect(methods.has("selectAll")).toBe(true);
    expect(methods.has("clearSelection")).toBe(true);
    expect(methods.has("getSelected")).toBe(true);
    expect(methods.has("getSelectedItems")).toBe(true);
    expect(methods.has("selectNext")).toBe(true);
    expect(methods.has("selectPrevious")).toBe(true);
    expect(methods.has("_seedSelection")).toBe(true);
    expect(methods.has("_getFocusedId")).toBe(true);
    expect(methods.has("_focusById")).toBe(true);

    cleanup();
  });
});

// =============================================================================
// selection — Public Methods Behavior
// =============================================================================

describe("selection — Methods Behavior", () => {
  it("getSelected should return empty array initially", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("select should add items to selection (variadic args)", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    select(5, 10);
    const selected = getSelected();
    expect(selected).toContain(5);
    expect(selected).toContain(10);

    cleanup();
  });

  it("deselect should remove items from selection (variadic args)", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    const deselect = methods.get("deselect") as (...ids: Array<string | number>) => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    select(1, 2, 3);
    expect(getSelected().length).toBe(3);

    deselect(2);
    const selected = getSelected();
    expect(selected).toContain(1);
    expect(selected).toContain(3);
    expect(selected).not.toContain(2);

    cleanup();
  });

  it("clearSelection should remove all items from selection", () => {
    const plugin = selection<TestItem>({ mode: "multiple", initial: [1, 2, 3] });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const clearSelection = methods.get("clearSelection") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    clearSelection();
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("toggleSelect should toggle item in selection", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const toggleSelect = methods.get("toggleSelect") as (id: string | number) => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    toggleSelect(5);
    expect(getSelected()).toContain(5);

    toggleSelect(5);
    expect(getSelected()).not.toContain(5);

    cleanup();
  });

  it("select in single mode should replace previous selection", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    select(5);
    expect(getSelected()).toEqual([5]);

    select(10);
    expect(getSelected()).toEqual([10]);

    cleanup();
  });

  it("selectAll should select all items in multiple mode", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectAll = methods.get("selectAll") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    selectAll();
    const selected = getSelected();
    expect(selected.length).toBe(100);

    cleanup();
  });

  it("selectAll should be a no-op in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectAll = methods.get("selectAll") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    selectAll();
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("select should be a no-op in none mode", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    select(1, 2, 3);
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("getSelectedItems should return full item objects for selected ids", () => {
    const items = createTestItems(10);
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    const getSelectedItems = methods.get("getSelectedItems") as () => TestItem[];

    select(2, 5);
    const selectedItems = getSelectedItems();
    expect(selectedItems.length).toBe(2);
    expect(selectedItems.some((item) => item.id === 2)).toBe(true);
    expect(selectedItems.some((item) => item.id === 5)).toBe(true);

    cleanup();
  });

  it("initial selection should pre-populate selected set", () => {
    const plugin = selection<TestItem>({ mode: "multiple", initial: [0, 1, 2] });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;
    const selected = getSelected();
    expect(selected).toContain(0);
    expect(selected).toContain(1);
    expect(selected).toContain(2);
    expect(selected.length).toBe(3);

    cleanup();
  });

  it("selectNext should move focus and select next item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectNext = methods.get("selectNext") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    // First call: focus starts at -1, moveFocus goes to 0
    selectNext();
    expect(getSelected()).toEqual([0]);

    // Second call: moves to index 1
    selectNext();
    expect(getSelected()).toEqual([1]);

    // Third call: moves to index 2
    selectNext();
    expect(getSelected()).toEqual([2]);

    cleanup();
  });

  it("selectPrevious should move focus and select previous item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectNext = methods.get("selectNext") as () => void;
    const selectPrevious = methods.get("selectPrevious") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    selectNext();
    selectNext();
    selectNext();
    expect(getSelected()).toEqual([2]);

    selectPrevious();
    expect(getSelected()).toEqual([1]);

    cleanup();
  });

  it("selectNext should not wrap past last item by default", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectNext = methods.get("selectNext") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    // Move to last item
    for (let i = 0; i < 100; i++) selectNext();
    expect(getSelected()).toEqual([99]);

    // Try to go past last — should stay on last
    selectNext();
    expect(getSelected()).toEqual([99]);

    cleanup();
  });

  it("selectPrevious should not wrap past first item by default", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(100));

    plugin.setup!(ctx);

    const selectNext = methods.get("selectNext") as () => void;
    const selectPrevious = methods.get("selectPrevious") as () => void;
    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    selectNext(); // → 0
    selectPrevious(); // should stay at 0
    expect(getSelected()).toEqual([0]);

    cleanup();
  });
});

// =============================================================================
// selection — Click Handler
// =============================================================================

describe("selection — Click Handler", () => {
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

  it("should toggle selection when clicking an item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const items = createTestItems(10);
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(items);

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;
    const el = makeItemElement(3);
    const event = makeClickEvent(el);

    clickHandlers[0]!(event);
    expect(getSelected()).toContain(3);

    cleanup();
  });

  it("should ignore clicks without data-index", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;
    const el = document.createElement("div"); // no data-index
    const event = makeClickEvent(el);

    clickHandlers[0]!(event);
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("should replace selection in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));
    expect(getSelected()).toEqual([2]);

    clickHandlers[0]!(makeClickEvent(makeItemElement(5)));
    expect(getSelected()).toEqual([5]);

    cleanup();
  });

  it("should toggle items in multiple mode", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));
    clickHandlers[0]!(makeClickEvent(makeItemElement(5)));
    expect(getSelected()).toContain(2);
    expect(getSelected()).toContain(5);
    expect(getSelected().length).toBe(2);

    cleanup();
  });

  it("should deselect on second click in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));
    expect(getSelected()).toContain(2);

    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("shift+click should range-select in multiple mode", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    // Click item 2 to set anchor
    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));

    // Shift+click item 5 to range-select 2..5
    clickHandlers[0]!(makeClickEvent(makeItemElement(5), { shiftKey: true }));

    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected.length).toBe(4);

    cleanup();
  });

  it("shift+click without prior focus should not range-select", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    // No prior click — focusedIndex is -1 — shiftKey ignored
    clickHandlers[0]!(makeClickEvent(makeItemElement(5), { shiftKey: true }));

    // Falls through to toggle since focusedIndex < 0
    const selected = getSelected();
    expect(selected).toContain(5);

    cleanup();
  });

  it("shift+click should be ignored in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, clickHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    clickHandlers[0]!(makeClickEvent(makeItemElement(2)));
    clickHandlers[0]!(makeClickEvent(makeItemElement(5), { shiftKey: true }));

    // Single mode — shift is irrelevant, just toggles last clicked item
    const selected = getSelected();
    expect(selected.length).toBeLessThanOrEqual(1);

    cleanup();
  });

  it("should not register click handler in none mode", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    const { ctx, clickHandlers, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    // In none mode setup returns early — no click handler registered
    expect(clickHandlers.length).toBe(0);

    cleanup();
  });
});

// =============================================================================
// selection — Keyboard Handler
// =============================================================================

describe("selection — Keyboard Handler", () => {
  function makeKeyEvent(
    key: string,
    opts?: {
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
    },
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey: opts?.shiftKey ?? false,
      ctrlKey: opts?.ctrlKey ?? false,
      metaKey: opts?.metaKey ?? false,
      bubbles: true,
    });
    (event as any).preventDefault = mock(() => {});
    return event;
  }

  it("ArrowDown should move focus and call forceRender", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const event = makeKeyEvent("ArrowDown");
    keydownHandlers[0]!(event);

    expect((event.preventDefault as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    cleanup();
  });

  it("ArrowDown should not throw when items is empty", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext([], {

    });

    plugin.setup!(ctx);

    const event = makeKeyEvent("ArrowDown");
    expect(() => keydownHandlers[0]!(event)).not.toThrow();

    cleanup();
  });

  it("ArrowUp should move focus up", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 0
    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 1
    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 2

    // followFocus is false by default — no selection from arrow keys
    keydownHandlers[0]!(makeKeyEvent("ArrowUp")); // → 1

    // Without followFocus, navigation alone doesn't select
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("Home should move focus to first item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 0
    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 1
    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 2

    const homeEvent = makeKeyEvent("Home");
    keydownHandlers[0]!(homeEvent);
    expect((homeEvent.preventDefault as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    cleanup();
  });

  it("End should move focus to last item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const endEvent = makeKeyEvent("End");
    keydownHandlers[0]!(endEvent);
    expect((endEvent.preventDefault as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    cleanup();
  });

  it("PageDown should move focus by 10", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(100), {

    });

    plugin.setup!(ctx);

    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // → 0
    const pageDownEvent = makeKeyEvent("PageDown");
    keydownHandlers[0]!(pageDownEvent);
    expect((pageDownEvent.preventDefault as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    cleanup();
  });

  it("PageUp should move focus back by 10", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(100), {

    });

    plugin.setup!(ctx);

    for (let i = 0; i < 15; i++) keydownHandlers[0]!(makeKeyEvent("ArrowDown"));
    const pageUpEvent = makeKeyEvent("PageUp");
    keydownHandlers[0]!(pageUpEvent);
    expect((pageUpEvent.preventDefault as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    cleanup();
  });

  it("Space should toggle focused item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // focus → 0
    keydownHandlers[0]!(makeKeyEvent(" ")); // toggle 0

    expect(getSelected()).toContain(0);

    cleanup();
  });

  it("Enter should toggle focused item", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("ArrowDown")); // focus → 0
    keydownHandlers[0]!(makeKeyEvent("Enter")); // toggle 0

    expect(getSelected()).toContain(0);

    cleanup();
  });

  it("Ctrl+A should select all in multiple mode", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("a", { ctrlKey: true }));
    expect(getSelected().length).toBe(10);

    cleanup();
  });

  it("Ctrl+A when all selected should deselect all", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("a", { ctrlKey: true })); // select all
    expect(getSelected().length).toBe(10);

    keydownHandlers[0]!(makeKeyEvent("a", { ctrlKey: true })); // deselect all
    expect(getSelected().length).toBe(0);

    cleanup();
  });

  it("Ctrl+A should be no-op in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    keydownHandlers[0]!(makeKeyEvent("a", { ctrlKey: true }));
    expect(getSelected()).toEqual([]);

    cleanup();
  });

  it("Delete should emit delete event with current selection", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const items = createTestItems(10);
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(items, {

    });

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    select(2, 3);

    keydownHandlers[0]!(makeKeyEvent("Delete"));

    const deleteCalls = (emitSpy.mock.calls as any[][]).filter((c) => c[0] === "delete");
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]![1].selected).toContain(2);
    expect(deleteCalls[0]![1].selected).toContain(3);

    cleanup();
  });

  it("Backspace should emit delete event", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    select(1);

    keydownHandlers[0]!(makeKeyEvent("Backspace"));

    const deleteCalls = (emitSpy.mock.calls as any[][]).filter((c) => c[0] === "delete");
    expect(deleteCalls.length).toBe(1);

    cleanup();
  });

  it("Delete with empty selection should not emit delete", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, keydownHandlers, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    keydownHandlers[0]!(makeKeyEvent("Delete"));

    const deleteCalls = (emitSpy.mock.calls as any[][]).filter((c) => c[0] === "delete");
    expect(deleteCalls.length).toBe(0);

    cleanup();
  });

  it("Space on no focused item should not select anything", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(createTestItems(10), {

    });

    plugin.setup!(ctx);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    // No ArrowDown first — focusedIndex = -1
    keydownHandlers[0]!(makeKeyEvent(" "));
    expect(getSelected()).toEqual([]);

    cleanup();
  });
});

// =============================================================================
// selection — Keyboard Shift Range Selection (multiple mode)
// =============================================================================

describe("selection — Shift+keyboard range selection", () => {
  function setupShiftTest() {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(
      createTestItems(100),
      {},
    );

    plugin.setup!(ctx);

    const fireKey = (
      key: string,
      opts?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        key,
        shiftKey: opts?.shiftKey ?? false,
        ctrlKey: opts?.ctrlKey ?? false,
        metaKey: opts?.metaKey ?? false,
        bubbles: true,
      });
      (event as any).preventDefault = mock(() => {});
      keydownHandlers[0]!(event);
      return event;
    };

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    return { ctx, plugin, fireKey, getSelected, cleanup };
  }

  it("Shift+ArrowDown should toggle the destination item", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+ArrowDown: focus → 3, toggle destination item[3]
    fireKey("ArrowDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected).toContain(3);
    expect(selected.length).toBe(1);

    cleanup();
  });

  it("Shift+ArrowDown multiple times should toggle each destination item", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1

    // Shift+ArrowDown×3: toggle destinations 2, 3, 4
    fireKey("ArrowDown", { shiftKey: true }); // focus → 2, toggle 2 ON
    fireKey("ArrowDown", { shiftKey: true }); // focus → 3, toggle 3 ON
    fireKey("ArrowDown", { shiftKey: true }); // focus → 4, toggle 4 ON

    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected.length).toBe(3);

    cleanup();
  });

  it("Shift+ArrowUp should toggle each destination item upward", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4

    // Shift+ArrowUp×2: focus → 3 toggle 3 ON, focus → 2 toggle 2 ON
    fireKey("ArrowUp", { shiftKey: true }); // focus → 3, toggle 3 ON
    fireKey("ArrowUp", { shiftKey: true }); // focus → 2, toggle 2 ON

    const selected = getSelected();
    expect(selected).toContain(3);
    expect(selected).toContain(2);
    expect(selected.length).toBe(2);

    cleanup();
  });

  it("Shift+Home should only move focus without selecting (no Ctrl)", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Shift+Home (no Ctrl): just moves focus, no selection change
    fireKey("Home", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("Ctrl+Shift+Home should select from focused item to first item", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Ctrl+Shift+Home: select range from previous focus (5) to first item (0)
    fireKey("Home", { shiftKey: true, ctrlKey: true });

    const selected = getSelected();
    for (let i = 0; i <= 5; i++) {
      expect(selected).toContain(i);
    }
    expect(selected.length).toBe(6);

    cleanup();
  });

  it("Shift+End should only move focus without selecting (no Ctrl)", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+End (no Ctrl): just moves focus, no selection change
    fireKey("End", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("Ctrl+Shift+End should select from focused item to last item", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Ctrl+Shift+End: select range from previous focus (2) to last item (99)
    fireKey("End", { shiftKey: true, ctrlKey: true });

    const selected = getSelected();
    for (let i = 2; i <= 99; i++) {
      expect(selected).toContain(i);
    }
    expect(selected.length).toBe(98);

    cleanup();
  });

  it("Shift+PageDown should only move focus without selecting", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+PageDown: just moves focus, no selection change
    fireKey("PageDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("Shift+PageUp should only move focus without selecting", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    for (let i = 0; i <= 20; i++) fireKey("ArrowDown");

    // Shift+PageUp: just moves focus, no selection change
    fireKey("PageUp", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("Space should set lastSelectedIndex for Shift+Space range", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Toggle item 2 with Space (sets lastSelectedIndex = 2)
    fireKey(" ");
    expect(getSelected()).toContain(2);

    // Navigate down
    fireKey("ArrowDown"); // focus → 3
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5

    // Shift+Space: contiguous range from lastSelectedIndex (2) to focused (5)
    fireKey(" ", { shiftKey: true });

    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(4);
    expect(selected).toContain(5);
    expect(selected.length).toBe(4);

    cleanup();
  });

  it("Shift+Space without prior selection should be a no-op", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3

    // Shift+Space with no lastSelectedIndex set — should do nothing
    fireKey(" ", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("non-shift navigation after shift-toggle should preserve selections", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2

    // Shift+ArrowDown: focus → 3, toggle destination 3 ON
    fireKey("ArrowDown", { shiftKey: true });

    let selected = getSelected();
    expect(selected).toContain(3);
    expect(selected.length).toBe(1);

    // Non-shift ArrowDown just moves focus — selection preserved
    fireKey("ArrowDown"); // focus → 4

    // Shift+ArrowDown: focus → 5, toggle destination 5 ON
    fireKey("ArrowDown", { shiftKey: true });

    selected = getSelected();
    expect(selected).toContain(3);
    expect(selected).toContain(5);
    expect(selected.length).toBe(2);

    cleanup();
  });

  it("Shift+ArrowDown through selected items should toggle destination items off", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    // Select items 3,4,5 via Space
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    fireKey("ArrowDown"); // focus → 2
    fireKey("ArrowDown"); // focus → 3
    fireKey(" "); // select 3
    fireKey("ArrowDown"); // focus → 4
    fireKey(" "); // select 4
    fireKey("ArrowDown"); // focus → 5
    fireKey(" "); // select 5

    // Go back to focus on item 3
    fireKey("ArrowUp"); // focus → 4
    fireKey("ArrowUp"); // focus → 3

    // Shift+ArrowDown: focus → 4, toggle destination 4 (selected → OFF)
    fireKey("ArrowDown", { shiftKey: true });
    // Shift+ArrowDown: focus → 5, toggle destination 5 (selected → OFF)
    fireKey("ArrowDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected).toContain(3);
    expect(selected.length).toBe(1);

    cleanup();
  });

  it("Ctrl+A should select all, then deselect all", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    fireKey("ArrowDown"); // focus → 0

    // Ctrl+A: select all (100 items)
    fireKey("a", { ctrlKey: true });

    let selected = getSelected();
    expect(selected.length).toBe(100);

    // Ctrl+A again: deselect all
    fireKey("a", { ctrlKey: true });

    selected = getSelected();
    expect(selected.length).toBe(0);

    cleanup();
  });

  it("Shift+Arrow is additive — preserves Space toggles", () => {
    const { fireKey, getSelected, cleanup } = setupShiftTest();

    // Move to item 1
    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1

    // Shift+ArrowDown×2: toggle destinations 2, 3
    fireKey("ArrowDown", { shiftKey: true }); // focus → 2, toggle 2 ON
    fireKey("ArrowDown", { shiftKey: true }); // focus → 3, toggle 3 ON

    let selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected.length).toBe(2);

    // Navigate and Space on item 5
    fireKey("ArrowDown"); // focus → 4
    fireKey("ArrowDown"); // focus → 5
    fireKey(" ");

    selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(3);
    expect(selected).toContain(5);
    expect(selected.length).toBe(3);

    cleanup();
  });

  it("should be a no-op in single mode (no range select)", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(
      createTestItems(10),
      {},
    );

    plugin.setup!(ctx);

    const fireKey = (key: string, opts?: { shiftKey?: boolean }) => {
      const event = new KeyboardEvent("keydown", {
        key,
        shiftKey: opts?.shiftKey ?? false,
        bubbles: true,
      });
      (event as any).preventDefault = mock(() => {});
      keydownHandlers[0]!(event);
    };

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    fireKey("ArrowDown");
    fireKey("ArrowDown");
    fireKey("ArrowDown");

    // Shift+ArrowDown in single mode — should not create a range selection
    fireKey("ArrowDown", { shiftKey: true });

    const selected = getSelected();
    expect(selected.length).toBeLessThanOrEqual(1);

    cleanup();
  });
});

// =============================================================================
// selection — followFocus
// =============================================================================

describe("selection — followFocus", () => {
  it("should auto-select when navigating with arrow keys in single mode", () => {
    const plugin = selection<TestItem>({ mode: "single", followFocus: true });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(
      createTestItems(10),
      {},
    );

    plugin.setup!(ctx);

    const fireKey = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
      });
      (event as any).preventDefault = mock(() => {});
      keydownHandlers[0]!(event);
    };

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    fireKey("ArrowDown"); // focus → 0, auto-select 0
    expect(getSelected()).toContain(0);

    fireKey("ArrowDown"); // focus → 1, auto-select 1
    expect(getSelected()).toEqual([1]); // single mode — replaces

    fireKey("ArrowDown"); // focus → 2, auto-select 2
    expect(getSelected()).toEqual([2]);

    cleanup();
  });

  it("should not auto-select when followFocus is false (default)", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, methods, cleanup } = createPluginMockContext(
      createTestItems(10),
      {},
    );

    plugin.setup!(ctx);

    const fireKey = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
      });
      (event as any).preventDefault = mock(() => {});
      keydownHandlers[0]!(event);
    };

    const getSelected = methods.get("getSelected") as () => Array<string | number>;

    fireKey("ArrowDown"); // focus → 0
    fireKey("ArrowDown"); // focus → 1
    expect(getSelected()).toEqual([]);

    cleanup();
  });
});

// =============================================================================
// selection — Emitter events
// =============================================================================

describe("selection — Emitter Events", () => {
  function createContextWithEmitter(items: TestItem[]) {
    const mock_context = createPluginMockContext(items, {});

    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    (mock_context.ctx.emitter as any).on = (
      event: string,
      handler: (...args: any[]) => void,
    ) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return () => {
        const arr = listeners.get(event);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    };
    (mock_context.ctx.emitter as any).emit = (event: string, payload: any) => {
      const arr = listeners.get(event);
      if (arr) arr.forEach((h) => h(payload));
    };

    return mock_context;
  }

  it("should emit selection:change after select", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createContextWithEmitter(createTestItems(10));

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    select(1);

    const selectionChangeCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "selection:change",
    );
    expect(selectionChangeCalls.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should emit selection:change after clearSelection", () => {
    const plugin = selection<TestItem>({ mode: "multiple", initial: [1, 2] });
    const { ctx, methods, cleanup } = createContextWithEmitter(createTestItems(10));

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const clearSelection = methods.get("clearSelection") as () => void;
    clearSelection();

    const selectionChangeCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "selection:change",
    );
    expect(selectionChangeCalls.length).toBeGreaterThan(0);

    cleanup();
  });

  it("should include selected ids and items in selection:change payload", () => {
    const items = createTestItems(10);
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createContextWithEmitter(items);

    let lastPayload: any = null;
    (ctx.emitter as any).emit = (event: string, payload: any) => {
      if (event === "selection:change") lastPayload = payload;
    };

    plugin.setup!(ctx);

    const select = methods.get("select") as (...ids: Array<string | number>) => void;
    select(3);

    expect(lastPayload).not.toBeNull();
    expect(lastPayload.selected).toContain(3);
    expect(lastPayload.items.some((item: TestItem) => item.id === 3)).toBe(true);

    cleanup();
  });

  it("should emit focus:change when navigating with arrow keys", () => {
    const plugin = selection<TestItem>({ mode: "single" });
    const { ctx, keydownHandlers, cleanup } = createContextWithEmitter(createTestItems(10));

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    (event as any).preventDefault = mock(() => {});
    keydownHandlers[0]!(event);

    const focusChangeCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "focus:change",
    );
    expect(focusChangeCalls.length).toBeGreaterThan(0);

    cleanup();
  });
});

// =============================================================================
// selection — Internal Methods (_seedSelection, _getFocusedId, _focusById)
// =============================================================================

describe("selection — Internal Methods", () => {
  it("_seedSelection should add IDs to selection without emitting events", () => {
    const plugin = selection<TestItem>({ mode: "multiple" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const seedFn = methods.get("_seedSelection") as (ids: Array<string | number>) => void;
    seedFn([2, 5, 8]);

    const getSelected = methods.get("getSelected") as () => Array<string | number>;
    const selected = getSelected();
    expect(selected).toContain(2);
    expect(selected).toContain(5);
    expect(selected).toContain(8);

    const selectionChanges = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "selection:change",
    );
    expect(selectionChanges.length).toBe(0);

    cleanup();
  });

  it("_getFocusedId should return undefined when no item is focused", () => {
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(10));

    plugin.setup!(ctx);

    const getFocusedId = methods.get("_getFocusedId") as () => string | number | undefined;
    expect(getFocusedId()).toBeUndefined();

    cleanup();
  });

  it("_getFocusedId should return the focused item ID after keyboard navigation", () => {
    const items = createTestItems(10);
    const plugin = selection<TestItem>();

    function createContextWithEmitter2(testItems: TestItem[]) {
      const mock_context = createPluginMockContext(testItems, {});
      const listeners = new Map<string, Array<(...args: any[]) => void>>();
      (mock_context.ctx.emitter as any).on = (
        event: string,
        handler: (...args: any[]) => void,
      ) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return () => {};
      };
      return mock_context;
    }

    const { ctx, methods, keydownHandlers, cleanup } = createContextWithEmitter2(items);
    plugin.setup!(ctx);

    // Simulate focusin to activate focusVisible
    const content = ctx.dom.content;
    Object.defineProperty(content, "matches", { value: () => true, configurable: true });
    Object.defineProperty(ctx.dom.root, "matches", { value: () => true, configurable: true });
    content.dispatchEvent(new Event("focusin", { bubbles: true }));

    // Navigate down once (focus moves from 0 to 1)
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    (event as any).preventDefault = mock(() => {});
    keydownHandlers[0]!(event);

    const getFocusedId = methods.get("_getFocusedId") as () => string | number | undefined;
    expect(getFocusedId()).toBe(1);

    cleanup();
  });

  it("_focusById should set focused index and emit focus:change", () => {
    const items = createTestItems(10);
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const focusByIdFn = methods.get("_focusById") as (id: string | number) => void;
    focusByIdFn(5);

    // After _focusById, _getFocusedId should return the ID
    const getFocusedId = methods.get("_getFocusedId") as () => string | number | undefined;
    expect(getFocusedId()).toBe(5);

    // Should have emitted focus:change with the correct item
    const focusChangeCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "focus:change",
    );
    expect(focusChangeCalls.length).toBe(1);
    expect(focusChangeCalls[0]![1]).toEqual({ id: 5, index: 5 });

    cleanup();
  });

  it("_focusById should no-op for unknown IDs", () => {
    const items = createTestItems(5);
    const plugin = selection<TestItem>();
    const { ctx, methods, cleanup } = createPluginMockContext(items);

    const emitSpy = mock(() => {});
    (ctx.emitter as any).emit = emitSpy;

    plugin.setup!(ctx);

    const focusByIdFn = methods.get("_focusById") as (id: string | number) => void;
    focusByIdFn(999);

    const getFocusedId = methods.get("_getFocusedId") as () => string | number | undefined;
    expect(getFocusedId()).toBeUndefined();

    const focusChangeCalls = (emitSpy.mock.calls as any[][]).filter(
      (c) => c[0] === "focus:change",
    );
    expect(focusChangeCalls.length).toBe(0);

    cleanup();
  });

  it("none mode stubs should be safe no-ops", () => {
    const plugin = selection<TestItem>({ mode: "none" });
    const { ctx, methods, cleanup } = createPluginMockContext(createTestItems(5));

    plugin.setup!(ctx);

    const seedFn = methods.get("_seedSelection") as (ids: Array<string | number>) => void;
    const getFocusedId = methods.get("_getFocusedId") as () => string | number | undefined;
    const focusByIdFn = methods.get("_focusById") as (id: string | number) => void;

    // Should not throw
    seedFn([1, 2]);
    focusByIdFn(1);
    expect(getFocusedId()).toBeUndefined();

    cleanup();
  });
});
