/**
 * vlist - Data Management Tests
 * Tests for DataManager with sparse storage support
 */

import { describe, it, expect, mock } from "bun:test";
import {
  createDataManager,
  mergeRanges,
  calculateMissingRanges,
} from "../../src/data";

import type { VListItem, VListAdapter } from "../../src/types";

// Test data helpers
const createTestItems = (count: number, startId: number = 1): VListItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Item ${startId + i}`,
  }));
};

const createMockAdapter = <T extends VListItem = VListItem>(
  items: T[],
  delay: number = 0,
): VListAdapter<T> => ({
  read: async ({ offset, limit }) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const slicedItems = items.slice(offset, offset + limit);
    return {
      items: slicedItems,
      total: items.length,
      hasMore: offset + limit < items.length,
    };
  },
});

describe("createDataManager", () => {
  describe("initialization", () => {
    it("should create manager without adapter", () => {
      const manager = createDataManager();

      expect(manager.getState().total).toBe(0);
      expect(manager.getState().cached).toBe(0);
    });

    it("should create manager with initial items", () => {
      const items = createTestItems(5);
      const manager = createDataManager({
        initialItems: items,
      });

      expect(manager.getState().total).toBe(5);
      expect(manager.getState().cached).toBe(5);
      expect(manager.getItem(0)).toEqual(items[0]);
    });

    it("should create manager with initial total", () => {
      const manager = createDataManager({
        initialTotal: 100,
      });

      expect(manager.getState().total).toBe(100);
      expect(manager.getState().cached).toBe(0);
    });

    it("should call onStateChange when state changes", () => {
      const onStateChange = mock(() => {});
      const manager = createDataManager({
        onStateChange,
      });

      manager.setItems(createTestItems(3));

      expect(onStateChange).toHaveBeenCalled();
    });

    it("should call onItemsLoaded when items are set", () => {
      const onItemsLoaded = mock(() => {});
      const manager = createDataManager({
        onItemsLoaded,
      });

      manager.setItems(createTestItems(3));

      expect(onItemsLoaded).toHaveBeenCalled();
    });
  });

  describe("setItems", () => {
    it("should set items at offset 0", () => {
      const manager = createDataManager();
      const items = createTestItems(5);

      manager.setItems(items);

      expect(manager.getState().total).toBe(5);
      expect(manager.getItem(0)).toEqual(items[0]);
      expect(manager.getItem(4)).toEqual(items[4]);
    });

    it("should set items at specific offset", () => {
      const manager = createDataManager();
      const items = createTestItems(5);

      manager.setItems(items, 10);

      expect(manager.getItem(10)).toEqual(items[0]);
      expect(manager.getItem(14)).toEqual(items[4]);
    });

    it("should update total if provided", () => {
      const manager = createDataManager();
      const items = createTestItems(10);

      manager.setItems(items, 0, 100);

      expect(manager.getState().cached).toBe(10);
      expect(manager.getState().total).toBe(100);
      expect(manager.getState().hasMore).toBe(true);
    });

    it("should set hasMore to false when cached matches total", () => {
      const manager = createDataManager();
      const items = createTestItems(10);

      manager.setItems(items, 0, 10);

      expect(manager.getState().hasMore).toBe(false);
    });
  });

  describe("setTotal", () => {
    it("should update total count", () => {
      const manager = createDataManager();

      manager.setTotal(1000);

      expect(manager.getState().total).toBe(1000);
    });

    it("should update hasMore based on cached vs total", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      manager.setTotal(100);
      expect(manager.getState().hasMore).toBe(true);

      manager.setTotal(10);
      expect(manager.getState().hasMore).toBe(false);
    });
  });

  describe("updateItem", () => {
    it("should update item by id", () => {
      const items = createTestItems(5);
      const manager = createDataManager({ initialItems: items });

      const result = manager.updateItem(3, { name: "Updated Item 3" });

      expect(result).toBe(true);
      expect(manager.getItemById(3)?.name).toBe("Updated Item 3");
    });

    it("should return false for non-existent id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      const result = manager.updateItem(999, { name: "Updated" });

      expect(result).toBe(false);
    });

    it("should merge updates with existing item", () => {
      const items = [{ id: 1, name: "Item 1", extra: "data" }];
      const manager = createDataManager({ initialItems: items });

      manager.updateItem(1, { name: "Updated" });

      const item = manager.getItemById(1) as {
        id: number;
        name: string;
        extra: string;
      };
      expect(item?.name).toBe("Updated");
      expect(item?.extra).toBe("data");
    });
  });

  describe("removeItem", () => {
    it("should remove item by id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      const result = manager.removeItem(3);

      expect(result).toBe(true);
      expect(manager.getItemById(3)).toBeUndefined();
    });

    it("should update total", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      manager.removeItem(3);

      expect(manager.getState().total).toBe(4);
    });

    it("should return false for non-existent id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      const result = manager.removeItem(999);

      expect(result).toBe(false);
    });
  });

  describe("getItem", () => {
    it("should return item by index", () => {
      const items = createTestItems(5);
      const manager = createDataManager({ initialItems: items });

      const item = manager.getItem(2);

      expect(item).toEqual(items[2]);
    });

    it("should return placeholder for unloaded index within total", () => {
      const manager = createDataManager({ initialTotal: 100 });

      const item = manager.getItem(50);

      // Should return a placeholder (has _isPlaceholder flag)
      expect(item).toBeDefined();
      expect((item as any)?._isPlaceholder).toBe(true);
    });

    it("should return undefined for index beyond total", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.getItem(10)).toBeUndefined();
    });

    it("should return undefined for negative index", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.getItem(-1)).toBeUndefined();
    });
  });

  describe("getItemById", () => {
    it("should return item by id", () => {
      const items = createTestItems(5);
      const manager = createDataManager({ initialItems: items });

      const item = manager.getItemById(3);

      expect(item?.id).toBe(3);
    });

    it("should return undefined for non-existent id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.getItemById(999)).toBeUndefined();
    });
  });

  describe("getIndexById", () => {
    it("should return index for existing id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.getIndexById(3)).toBe(2); // id 3 is at index 2
    });

    it("should return -1 for non-existent id", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.getIndexById(999)).toBe(-1);
    });
  });

  describe("isItemLoaded", () => {
    it("should return true for loaded item", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      expect(manager.isItemLoaded(2)).toBe(true);
    });

    it("should return false for unloaded item", () => {
      const manager = createDataManager({ initialTotal: 100 });

      expect(manager.isItemLoaded(50)).toBe(false);
    });
  });

  describe("getItemsInRange", () => {
    it("should return items in range", () => {
      const items = createTestItems(10);
      const manager = createDataManager({ initialItems: items });

      const rangeItems = manager.getItemsInRange(2, 5);

      expect(rangeItems).toHaveLength(4);
      expect(rangeItems[0]?.id).toBe(3); // index 2 = id 3
      expect(rangeItems[3]?.id).toBe(6); // index 5 = id 6
    });

    it("should return placeholders for unloaded items", () => {
      const manager = createDataManager({ initialTotal: 100 });

      const rangeItems = manager.getItemsInRange(10, 15);

      expect(rangeItems).toHaveLength(6);
      rangeItems.forEach((item) => {
        expect((item as any)?._isPlaceholder).toBe(true);
      });
    });

    it("should clamp to total", () => {
      const items = createTestItems(5);
      const manager = createDataManager({ initialItems: items });

      const rangeItems = manager.getItemsInRange(0, 100);

      expect(rangeItems).toHaveLength(5);
    });
  });

  describe("loadRange", () => {
    it("should load data using adapter", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({ adapter });

      await manager.loadRange(0, 19);

      // Items are loaded (may be more due to chunk alignment)
      expect(manager.getState().cached).toBeGreaterThanOrEqual(20);
      expect(manager.getState().total).toBe(100);
      expect(manager.isItemLoaded(0)).toBe(true);
      expect(manager.isItemLoaded(19)).toBe(true);
    });

    it("should set isLoading during load", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items, 50);
      const manager = createDataManager({ adapter });

      const loadPromise = manager.loadRange(0, 19);

      expect(manager.getState().isLoading).toBe(true);

      await loadPromise;

      expect(manager.getState().isLoading).toBe(false);
    });

    it("should do nothing without adapter", async () => {
      const manager = createDataManager();

      await manager.loadRange(0, 19);

      expect(manager.getState().cached).toBe(0);
    });
  });

  describe("ensureRange", () => {
    it("should not reload already loaded range", async () => {
      const items = createTestItems(100);
      const readMock = mock(
        async ({ offset, limit }: { offset: number; limit: number }) => ({
          items: items.slice(offset, offset + limit),
          total: 100,
          hasMore: offset + limit < 100,
        }),
      );
      const adapter: VListAdapter = { read: readMock };
      const manager = createDataManager({ adapter });

      await manager.ensureRange(0, 19);
      const callCountAfterFirst = readMock.mock.calls.length;

      await manager.ensureRange(5, 15); // Subset of already loaded

      // Should not make additional calls for already loaded subset
      expect(readMock.mock.calls.length).toBe(callCountAfterFirst);
    });

    it("should load missing range", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        initialTotal: 100, // Must set total for sparse storage to work
      });

      await manager.ensureRange(0, 19);
      await manager.ensureRange(40, 59);

      expect(manager.isItemLoaded(0)).toBe(true);
      expect(manager.isItemLoaded(50)).toBe(true);
    });
  });

  describe("loadInitial", () => {
    it("should load initial data", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        pageSize: 20,
      });

      await manager.loadInitial();

      // Should load at least pageSize items (may be more due to chunk alignment)
      expect(manager.getState().cached).toBeGreaterThanOrEqual(20);
      expect(manager.getState().total).toBe(100);
      expect(manager.isItemLoaded(0)).toBe(true);
    });

    it("should do nothing without adapter", async () => {
      const manager = createDataManager();

      await manager.loadInitial();

      expect(manager.getState().cached).toBe(0);
    });
  });

  describe("loadMore", () => {
    it("should append loaded items", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        pageSize: 20,
      });

      await manager.loadInitial();
      const cachedAfterInitial = manager.getState().cached;

      // Only try loadMore if we haven't loaded everything
      if (cachedAfterInitial < 100) {
        const result = await manager.loadMore();
        expect(result).toBe(true);
        expect(manager.getState().cached).toBeGreaterThan(cachedAfterInitial);
      } else {
        // All items already loaded
        const result = await manager.loadMore();
        expect(result).toBe(false);
      }
    });

    it("should return false when no adapter", async () => {
      const manager = createDataManager();

      const result = await manager.loadMore();

      expect(result).toBe(false);
    });

    it("should return false when no more items", async () => {
      const items = createTestItems(30);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        pageSize: 50,
      });

      await manager.loadInitial();
      const result = await manager.loadMore();

      expect(result).toBe(false);
    });
  });

  describe("reload", () => {
    it("should clear and reload data", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        pageSize: 50,
      });

      await manager.loadInitial();
      const cachedAfterInitial = manager.getState().cached;
      expect(cachedAfterInitial).toBeGreaterThanOrEqual(50);

      await manager.reload();

      // After reload, should have similar amount of data
      expect(manager.getState().cached).toBeGreaterThanOrEqual(50);
      expect(manager.isItemLoaded(0)).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all data", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      manager.clear();

      expect(manager.getState().cached).toBe(0);
      expect(manager.getState().isLoading).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset to initial state", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      manager.reset();

      expect(manager.getState().cached).toBe(0);
      expect(manager.getState().total).toBe(0);
      expect(manager.getState().hasMore).toBe(true);
    });
  });
});

describe("mergeRanges", () => {
  it("should merge overlapping ranges", () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ];

    const merged = mergeRanges(ranges);

    expect(merged).toEqual([{ start: 0, end: 15 }]);
  });

  it("should merge adjacent ranges", () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 11, end: 20 },
    ];

    const merged = mergeRanges(ranges);

    expect(merged).toEqual([{ start: 0, end: 20 }]);
  });

  it("should not merge non-overlapping ranges", () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];

    const merged = mergeRanges(ranges);

    expect(merged).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });

  it("should handle single range", () => {
    const ranges = [{ start: 5, end: 15 }];

    const merged = mergeRanges(ranges);

    expect(merged).toEqual([{ start: 5, end: 15 }]);
  });

  it("should handle empty array", () => {
    expect(mergeRanges([])).toEqual([]);
  });

  it("should sort ranges before merging", () => {
    const ranges = [
      { start: 20, end: 30 },
      { start: 0, end: 10 },
      { start: 5, end: 25 },
    ];

    const merged = mergeRanges(ranges);

    expect(merged).toEqual([{ start: 0, end: 30 }]);
  });
});

describe("calculateMissingRanges", () => {
  // Note: calculateMissingRanges aligns ranges to chunk boundaries
  // Using chunkSize=10 for predictable tests

  it("should return chunk-aligned range when nothing loaded", () => {
    // With chunkSize 10, range 10-30 aligns to 10-39
    const missing = calculateMissingRanges({ start: 10, end: 30 }, [], 10);

    expect(missing.length).toBe(1);
    expect(missing[0]!.start).toBe(10);
    // End is aligned to chunk boundary
    expect(missing[0]!.end).toBeGreaterThanOrEqual(30);
  });

  it("should return empty when range fully loaded", () => {
    const loaded = [{ start: 0, end: 99 }];
    const missing = calculateMissingRanges({ start: 10, end: 30 }, loaded, 10);

    expect(missing).toEqual([]);
  });

  it("should find gap at start", () => {
    const loaded = [{ start: 20, end: 99 }];
    const missing = calculateMissingRanges({ start: 10, end: 30 }, loaded, 10);

    // Should find gap from 10 to 19
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]!.start).toBe(10);
    expect(missing[0]!.end).toBe(19);
  });

  it("should find gap at end", () => {
    const loaded = [{ start: 0, end: 19 }];
    const missing = calculateMissingRanges({ start: 10, end: 30 }, loaded, 10);

    // Should find gap from 20 to aligned end
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]!.start).toBe(20);
  });

  it("should find gap in middle", () => {
    const loaded = [
      { start: 0, end: 9 },
      { start: 30, end: 99 },
    ];
    const missing = calculateMissingRanges({ start: 5, end: 35 }, loaded, 10);

    // Should find gap from 10 to 29
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]!.start).toBe(10);
    expect(missing[0]!.end).toBe(29);
  });

  it("should find multiple gaps", () => {
    const loaded = [
      { start: 10, end: 19 },
      { start: 30, end: 39 },
    ];
    const missing = calculateMissingRanges({ start: 0, end: 50 }, loaded, 10);

    // Should find gaps: 0-9, 20-29, 40-59 (chunk aligned)
    expect(missing.length).toBeGreaterThanOrEqual(2);
    // First gap should start at 0
    expect(missing[0]!.start).toBe(0);
  });
});
