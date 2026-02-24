/**
 * vlist - Builder SimpleDataManager Tests
 * Tests for the lightweight in-memory data manager used by the builder core.
 *
 * Covers:
 * - Factory creation and initial state
 * - Item access (getItem, isItemLoaded, getItemsInRange)
 * - Data operations (setItems, updateItem, removeItem)
 * - setTotal
 * - clear / reset
 * - Callback notifications (onStateChange, onItemsLoaded)
 * - Stub methods (loadRange, ensureRange, loadInitial, loadMore, reload, evictDistant)
 * - Edge cases (empty list, out-of-bounds, partial set, offset append)
 */

import { describe, it, expect, mock } from "bun:test";
import {
  createSimpleDataManager,
  type SimpleDataManager,
} from "../../src/builder/data";
import type { VListItem } from "../../src/types";

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number, startId = 0): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Item ${startId + i}`,
  }));

// =============================================================================
// Factory / Initial State
// =============================================================================

describe("createSimpleDataManager", () => {
  it("should create with default empty state", () => {
    const dm = createSimpleDataManager<TestItem>();
    const state = dm.getState();

    expect(state.total).toBe(0);
    expect(state.cached).toBe(0);
    expect(state.isLoading).toBe(false);
    expect(state.pendingRanges).toEqual([]);
    expect(state.error).toBeUndefined();
    expect(state.hasMore).toBe(false);
    expect(state.cursor).toBeUndefined();
  });

  it("should create with initial items", () => {
    const items = createTestItems(5);
    const dm = createSimpleDataManager<TestItem>({ initialItems: items });

    expect(dm.getTotal()).toBe(5);
    expect(dm.getCached()).toBe(5);
    expect(dm.getItem(0)).toEqual({ id: 0, name: "Item 0" });
    expect(dm.getItem(4)).toEqual({ id: 4, name: "Item 4" });
  });

  it("should create with initial items and explicit total", () => {
    const items = createTestItems(5);
    const dm = createSimpleDataManager<TestItem>({
      initialItems: items,
      initialTotal: 100,
    });

    expect(dm.getTotal()).toBe(100);
    expect(dm.getCached()).toBe(5);
  });

  it("should infer total from items length when no initialTotal", () => {
    const items = createTestItems(10);
    const dm = createSimpleDataManager<TestItem>({ initialItems: items });

    expect(dm.getTotal()).toBe(10);
  });
});

// =============================================================================
// Getters
// =============================================================================

describe("getTotal / getCached", () => {
  it("should return 0 for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
  });

  it("should return correct counts after setItems", () => {
    const dm = createSimpleDataManager<TestItem>();
    dm.setItems(createTestItems(10));

    expect(dm.getTotal()).toBe(10);
    expect(dm.getCached()).toBe(10);
  });
});

describe("getIsLoading / getHasMore", () => {
  it("should always return false (no async support)", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.getIsLoading()).toBe(false);
    expect(dm.getHasMore()).toBe(false);
  });

  it("should return false even after operations", () => {
    const dm = createSimpleDataManager<TestItem>();
    dm.setItems(createTestItems(5));

    expect(dm.getIsLoading()).toBe(false);
    expect(dm.getHasMore()).toBe(false);
  });
});

describe("getStorage / getPlaceholders", () => {
  it("should return null (not used in simple manager)", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.getStorage()).toBeNull();
    expect(dm.getPlaceholders()).toBeNull();
  });
});

// =============================================================================
// Item Access
// =============================================================================

describe("getItem", () => {
  it("should return item at valid index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    expect(dm.getItem(0)).toEqual({ id: 0, name: "Item 0" });
    expect(dm.getItem(2)).toEqual({ id: 2, name: "Item 2" });
    expect(dm.getItem(4)).toEqual({ id: 4, name: "Item 4" });
  });

  it("should return undefined for out-of-bounds index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.getItem(-1)).toBeUndefined();
    expect(dm.getItem(3)).toBeUndefined();
    expect(dm.getItem(100)).toBeUndefined();
  });

  it("should return undefined for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.getItem(0)).toBeUndefined();
  });
});

describe("isItemLoaded", () => {
  it("should return true for loaded indices", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    expect(dm.isItemLoaded(0)).toBe(true);
    expect(dm.isItemLoaded(4)).toBe(true);
  });

  it("should return false for out-of-bounds", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.isItemLoaded(-1)).toBe(false);
    expect(dm.isItemLoaded(3)).toBe(false);
    expect(dm.isItemLoaded(100)).toBe(false);
  });

  it("should return false for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.isItemLoaded(0)).toBe(false);
  });
});

describe("getItemsInRange", () => {
  it("should return items in valid range", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(10),
    });

    const items = dm.getItemsInRange(2, 5);
    expect(items.length).toBe(4);
    expect(items[0]!.id).toBe(2);
    expect(items[3]!.id).toBe(5);
  });

  it("should clamp start to 0", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = dm.getItemsInRange(-5, 2);
    expect(items.length).toBe(3);
    expect(items[0]!.id).toBe(0);
  });

  it("should clamp end to total - 1", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = dm.getItemsInRange(3, 100);
    expect(items.length).toBe(2);
    expect(items[0]!.id).toBe(3);
    expect(items[1]!.id).toBe(4);
  });

  it("should return empty array for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    const items = dm.getItemsInRange(0, 10);
    expect(items.length).toBe(0);
  });

  it("should return full range for 0 to total-1", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = dm.getItemsInRange(0, 4);
    expect(items.length).toBe(5);
  });

  it("should return single item when start equals end", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = dm.getItemsInRange(2, 2);
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe(2);
  });
});

// =============================================================================
// setTotal
// =============================================================================

describe("setTotal", () => {
  it("should update total without affecting items", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.setTotal(100);
    expect(dm.getTotal()).toBe(100);
    expect(dm.getCached()).toBe(5);
    expect(dm.getItem(0)).toEqual({ id: 0, name: "Item 0" });
  });

  it("should allow setting total to 0", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.setTotal(0);
    expect(dm.getTotal()).toBe(0);
  });
});

// =============================================================================
// setItems
// =============================================================================

describe("setItems", () => {
  it("should set items and infer total from length", () => {
    const dm = createSimpleDataManager<TestItem>();
    const items = createTestItems(10);

    dm.setItems(items);

    expect(dm.getTotal()).toBe(10);
    expect(dm.getCached()).toBe(10);
    expect(dm.getItem(0)!.id).toBe(0);
    expect(dm.getItem(9)!.id).toBe(9);
  });

  it("should set items with explicit total", () => {
    const dm = createSimpleDataManager<TestItem>();
    const items = createTestItems(5);

    dm.setItems(items, 0, 100);

    expect(dm.getTotal()).toBe(100);
    expect(dm.getCached()).toBe(5);
  });

  it("should do full replacement when offset=0 and explicit total", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const newItems = createTestItems(3, 100);
    dm.setItems(newItems, 0, 3);

    expect(dm.getTotal()).toBe(3);
    expect(dm.getCached()).toBe(3);
    expect(dm.getItem(0)!.id).toBe(100);
    expect(dm.getItem(2)!.id).toBe(102);
  });

  it("should use partial set semantics when offset=0 without explicit total on pre-populated manager", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    // No explicit total + items.length > 0 → partial set branch
    const newItems = createTestItems(3, 100);
    dm.setItems(newItems);

    // Overwrites indices 0-2 but total stays max(5, 0+3) = 5
    expect(dm.getTotal()).toBe(5);
    expect(dm.getCached()).toBe(5);
    expect(dm.getItem(0)!.id).toBe(100);
    expect(dm.getItem(2)!.id).toBe(102);
    expect(dm.getItem(3)!.id).toBe(3); // original item untouched
    expect(dm.getItem(4)!.id).toBe(4); // original item untouched
  });

  it("should do full replacement on first setItems (empty manager)", () => {
    const dm = createSimpleDataManager<TestItem>();

    const items = createTestItems(3, 100);
    dm.setItems(items);

    // items.length === 0 before call → full replacement branch
    expect(dm.getTotal()).toBe(3);
    expect(dm.getCached()).toBe(3);
    expect(dm.getItem(0)!.id).toBe(100);
  });

  it("should append items at offset", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const moreItems = createTestItems(3, 100);
    dm.setItems(moreItems, 5);

    expect(dm.getTotal()).toBe(8);
    expect(dm.getCached()).toBe(8);
    expect(dm.getItem(4)!.id).toBe(4);
    expect(dm.getItem(5)!.id).toBe(100);
    expect(dm.getItem(7)!.id).toBe(102);
  });

  it("should overwrite items at offset in the middle", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(10),
    });

    const replacements = createTestItems(3, 500);
    dm.setItems(replacements, 3);

    expect(dm.getItem(2)!.id).toBe(2); // untouched
    expect(dm.getItem(3)!.id).toBe(500); // replaced
    expect(dm.getItem(4)!.id).toBe(501); // replaced
    expect(dm.getItem(5)!.id).toBe(502); // replaced
    expect(dm.getItem(6)!.id).toBe(6); // untouched
  });

  it("should update total from offset + length when larger", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = createTestItems(3, 50);
    dm.setItems(items, 10);

    // total should be max(5, 10+3) = 13
    expect(dm.getTotal()).toBe(13);
  });

  it("should use explicit total for partial set when provided", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const items = createTestItems(3, 50);
    dm.setItems(items, 5, 200);

    expect(dm.getTotal()).toBe(200);
  });

  it("should handle empty items array", () => {
    const dm = createSimpleDataManager<TestItem>();
    dm.setItems([]);

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
  });
});

// =============================================================================
// updateItem
// =============================================================================

describe("updateItem", () => {
  it("should update item at valid index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const result = dm.updateItem(2, { name: "Updated" });

    expect(result).toBe(true);
    expect(dm.getItem(2)!.name).toBe("Updated");
    expect(dm.getItem(2)!.id).toBe(2); // id preserved
  });

  it("should merge updates, not replace", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    dm.updateItem(0, { name: "New Name" });

    const item = dm.getItem(0)!;
    expect(item.id).toBe(0);
    expect(item.name).toBe("New Name");
  });

  it("should return false for negative index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.updateItem(-1, { name: "X" })).toBe(false);
  });

  it("should return false for out-of-bounds index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.updateItem(3, { name: "X" })).toBe(false);
    expect(dm.updateItem(100, { name: "X" })).toBe(false);
  });

  it("should return false for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.updateItem(0, { name: "X" })).toBe(false);
  });

  it("should not affect other items", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.updateItem(2, { name: "Changed" });

    expect(dm.getItem(1)!.name).toBe("Item 1");
    expect(dm.getItem(3)!.name).toBe("Item 3");
  });
});

// =============================================================================
// removeItem
// =============================================================================

describe("removeItem", () => {
  it("should remove item at valid index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const result = dm.removeItem(2);

    expect(result).toBe(true);
    expect(dm.getCached()).toBe(4);
    expect(dm.getTotal()).toBe(4);
    // Items shift: index 2 now holds what was index 3
    expect(dm.getItem(2)!.id).toBe(3);
  });

  it("should remove first item", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    dm.removeItem(0);

    expect(dm.getCached()).toBe(2);
    expect(dm.getItem(0)!.id).toBe(1);
    expect(dm.getItem(1)!.id).toBe(2);
  });

  it("should remove last item", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    dm.removeItem(2);

    expect(dm.getCached()).toBe(2);
    expect(dm.getItem(0)!.id).toBe(0);
    expect(dm.getItem(1)!.id).toBe(1);
    expect(dm.getItem(2)).toBeUndefined();
  });

  it("should return false for negative index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.removeItem(-1)).toBe(false);
    expect(dm.getCached()).toBe(3);
  });

  it("should return false for out-of-bounds index", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
    });

    expect(dm.removeItem(3)).toBe(false);
    expect(dm.removeItem(100)).toBe(false);
    expect(dm.getCached()).toBe(3);
  });

  it("should return false for empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();

    expect(dm.removeItem(0)).toBe(false);
  });

  it("should decrement total to minimum 0", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(1),
    });

    dm.removeItem(0);

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
  });

  it("should handle consecutive removals", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.removeItem(0); // removes id=0, now [1,2,3,4]
    dm.removeItem(0); // removes id=1, now [2,3,4]
    dm.removeItem(0); // removes id=2, now [3,4]

    expect(dm.getCached()).toBe(2);
    expect(dm.getTotal()).toBe(2);
    expect(dm.getItem(0)!.id).toBe(3);
    expect(dm.getItem(1)!.id).toBe(4);
  });
});

// =============================================================================
// clear / reset
// =============================================================================

describe("clear", () => {
  it("should remove all items and set total to 0", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(10),
    });

    dm.clear();

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
    expect(dm.getItem(0)).toBeUndefined();
  });

  it("should be safe on empty manager", () => {
    const dm = createSimpleDataManager<TestItem>();
    dm.clear();

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
  });
});

describe("reset", () => {
  it("should clear and notify state change", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(10),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.reset();

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Callbacks
// =============================================================================

describe("onStateChange callback", () => {
  it("should fire on setItems", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({ onStateChange });

    dm.setItems(createTestItems(5));

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const state = (onStateChange.mock.calls[0] as any[])[0];
    expect(state.total).toBe(5);
    expect(state.cached).toBe(5);
  });

  it("should fire on updateItem", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.updateItem(0, { name: "Changed" });

    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("should not fire on failed updateItem", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.updateItem(100, { name: "X" });

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("should fire on removeItem", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.removeItem(1);

    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("should not fire on failed removeItem", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.removeItem(100);

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("should fire on reset", () => {
    const onStateChange = mock((_state: any) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(3),
      onStateChange,
    });

    onStateChange.mockClear();
    dm.reset();

    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("should not fire when no callback configured", () => {
    // Should not throw
    const dm = createSimpleDataManager<TestItem>();
    dm.setItems(createTestItems(5));
    dm.updateItem(0, { name: "X" });
    dm.removeItem(0);
    dm.reset();
  });
});

describe("onItemsLoaded callback", () => {
  it("should fire on setItems with items, offset, total", () => {
    const onItemsLoaded = mock((..._args: any[]) => {});
    const dm = createSimpleDataManager<TestItem>({ onItemsLoaded });

    const items = createTestItems(5);
    dm.setItems(items);

    expect(onItemsLoaded).toHaveBeenCalledTimes(1);
    const args = onItemsLoaded.mock.calls[0] as any[];
    expect(args[0]).toBe(items);
    expect(args[1]).toBe(0);
    expect(args[2]).toBe(5);
  });

  it("should fire with correct offset for partial set", () => {
    const onItemsLoaded = mock((..._args: any[]) => {});
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
      onItemsLoaded,
    });

    onItemsLoaded.mockClear();
    const moreItems = createTestItems(3, 50);
    dm.setItems(moreItems, 5);

    expect(onItemsLoaded).toHaveBeenCalledTimes(1);
    const args = onItemsLoaded.mock.calls[0] as any[];
    expect(args[0]).toBe(moreItems);
    expect(args[1]).toBe(5);
    expect(args[2]).toBe(8);
  });

  it("should fire with explicit total when provided", () => {
    const onItemsLoaded = mock((..._args: any[]) => {});
    const dm = createSimpleDataManager<TestItem>({ onItemsLoaded });

    const items = createTestItems(5);
    dm.setItems(items, 0, 200);

    const args = onItemsLoaded.mock.calls[0] as any[];
    expect(args[2]).toBe(200);
  });
});

// =============================================================================
// Stub Methods (no-ops)
// =============================================================================

describe("stub methods", () => {
  it("loadRange should resolve without error", async () => {
    const dm = createSimpleDataManager<TestItem>();
    await expect(dm.loadRange(0, 10)).resolves.toBeUndefined();
  });

  it("ensureRange should resolve without error", async () => {
    const dm = createSimpleDataManager<TestItem>();
    await expect(dm.ensureRange(0, 10)).resolves.toBeUndefined();
  });

  it("loadInitial should resolve without error", async () => {
    const dm = createSimpleDataManager<TestItem>();
    await expect(dm.loadInitial()).resolves.toBeUndefined();
  });

  it("loadMore should resolve to false", async () => {
    const dm = createSimpleDataManager<TestItem>();
    const result = await dm.loadMore();
    expect(result).toBe(false);
  });

  it("loadMore with direction should resolve to false", async () => {
    const dm = createSimpleDataManager<TestItem>();
    expect(await dm.loadMore("down")).toBe(false);
    expect(await dm.loadMore("up")).toBe(false);
  });

  it("reload should resolve without error", async () => {
    const dm = createSimpleDataManager<TestItem>();
    await expect(dm.reload()).resolves.toBeUndefined();
  });

  it("evictDistant should be a no-op", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(10),
    });

    dm.evictDistant(3, 7);

    // Items should not be affected
    expect(dm.getCached()).toBe(10);
    expect(dm.getItem(0)!.id).toBe(0);
  });
});

// =============================================================================
// getState snapshot
// =============================================================================

describe("getState", () => {
  it("should return a fresh snapshot each call", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    const state1 = dm.getState();
    dm.setItems(createTestItems(10));
    const state2 = dm.getState();

    expect(state1.total).toBe(5);
    expect(state2.total).toBe(10);
  });

  it("should reflect state after operations", () => {
    const dm = createSimpleDataManager<TestItem>();

    dm.setItems(createTestItems(5));
    expect(dm.getState().total).toBe(5);
    expect(dm.getState().cached).toBe(5);

    dm.removeItem(0);
    expect(dm.getState().total).toBe(4);
    expect(dm.getState().cached).toBe(4);

    dm.clear();
    expect(dm.getState().total).toBe(0);
    expect(dm.getState().cached).toBe(0);
  });

  it("should always report static fields correctly", () => {
    const dm = createSimpleDataManager<TestItem>();
    const state = dm.getState();

    expect(state.isLoading).toBe(false);
    expect(state.hasMore).toBe(false);
    expect(state.cursor).toBeUndefined();
    expect(state.error).toBeUndefined();
    expect(state.pendingRanges).toEqual([]);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  it("should handle setItems after clear", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.clear();
    dm.setItems(createTestItems(3, 100));

    expect(dm.getTotal()).toBe(3);
    expect(dm.getItem(0)!.id).toBe(100);
  });

  it("should handle multiple setItems calls", () => {
    const dm = createSimpleDataManager<TestItem>();

    dm.setItems(createTestItems(5));
    expect(dm.getTotal()).toBe(5);

    dm.setItems(createTestItems(10, 50));
    expect(dm.getTotal()).toBe(10);
    expect(dm.getItem(0)!.id).toBe(50);
  });

  it("should handle setItems with single item", () => {
    const dm = createSimpleDataManager<TestItem>();
    dm.setItems([{ id: 42, name: "Solo" }]);

    expect(dm.getTotal()).toBe(1);
    expect(dm.getItem(0)!.id).toBe(42);
  });

  it("should handle remove until empty", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(2),
    });

    dm.removeItem(0);
    dm.removeItem(0);

    expect(dm.getTotal()).toBe(0);
    expect(dm.getCached()).toBe(0);
    expect(dm.getItem(0)).toBeUndefined();
  });

  it("should handle updateItem after removeItem", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    dm.removeItem(2); // removes id=2, shifts [0,1,3,4]
    dm.updateItem(2, { name: "Updated" }); // index 2 is now id=3

    expect(dm.getItem(2)!.id).toBe(3);
    expect(dm.getItem(2)!.name).toBe("Updated");
  });

  it("should handle large item count", () => {
    const dm = createSimpleDataManager<TestItem>();
    const largeItems = createTestItems(100_000);

    dm.setItems(largeItems);

    expect(dm.getTotal()).toBe(100_000);
    expect(dm.getItem(0)!.id).toBe(0);
    expect(dm.getItem(99_999)!.id).toBe(99_999);
  });

  it("should handle string IDs", () => {
    interface StringIdItem extends VListItem {
      id: string;
      label: string;
    }

    const dm = createSimpleDataManager<StringIdItem>({
      initialItems: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
    });

    expect(dm.getTotal()).toBe(3);
    expect(dm.getItem(1)!.id).toBe("b");

    dm.updateItem(1, { label: "Updated Beta" });
    expect(dm.getItem(1)!.label).toBe("Updated Beta");
  });

  it("should handle getItemsInRange where start > end after clamping", () => {
    const dm = createSimpleDataManager<TestItem>({
      initialItems: createTestItems(5),
    });

    // start=10 clamped to 10, end=-1 clamped to -1 → loop doesn't execute
    const items = dm.getItemsInRange(10, -1);
    expect(items.length).toBe(0);
  });
});