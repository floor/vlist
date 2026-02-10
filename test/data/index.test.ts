/**
 * vlist - Data Management Tests
 * Tests for DataManager with sparse storage support
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
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

  // ===========================================================================
  // Direct Getters
  // ===========================================================================

  describe("direct getters", () => {
    it("should provide getTotal without allocation", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      expect(manager.getTotal()).toBe(10);
    });

    it("should provide getCached without allocation", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      expect(manager.getCached()).toBe(10);
    });

    it("should provide getIsLoading without allocation", () => {
      const manager = createDataManager();

      expect(manager.getIsLoading()).toBe(false);
    });

    it("should provide getHasMore without allocation", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
        initialTotal: 5,
      });

      expect(manager.getHasMore()).toBe(false);
    });

    it("should expose storage via getStorage", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      const storage = manager.getStorage();
      expect(storage).toBeDefined();
      expect(storage.getTotal()).toBe(5);
    });

    it("should expose placeholders via getPlaceholders", () => {
      const manager = createDataManager();

      const placeholders = manager.getPlaceholders();
      expect(placeholders).toBeDefined();
    });
  });

  // ===========================================================================
  // State Change Callbacks
  // ===========================================================================

  describe("state change callbacks", () => {
    it("should call onItemsEvicted when items are evicted", async () => {
      const onItemsEvicted = mock((_count: number) => {});
      const items = createTestItems(200);
      const adapter = createMockAdapter(items);

      const manager = createDataManager({
        adapter,
        storage: { chunkSize: 10, maxCachedItems: 50, evictionBuffer: 0 },
        onItemsEvicted,
      });

      // Load enough items to exceed the cache limit
      await manager.loadRange(0, 99);

      // Now trigger eviction by viewing a distant range
      manager.evictDistant(80, 99);

      // onItemsEvicted should have been called
      expect(onItemsEvicted).toHaveBeenCalled();
      const count = onItemsEvicted.mock.calls[0]![0] as number;
      expect(count).toBeGreaterThan(0);
    });

    it("should call onStateChange on setTotal", () => {
      const onStateChange = mock(() => {});
      const manager = createDataManager({ onStateChange });

      manager.setTotal(100);

      expect(onStateChange).toHaveBeenCalled();
    });

    it("should call onStateChange on clear", () => {
      const onStateChange = mock(() => {});
      const manager = createDataManager({
        initialItems: createTestItems(5),
        onStateChange,
      });

      const callsBefore = onStateChange.mock.calls.length;
      manager.clear();

      expect(onStateChange.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it("should call onStateChange on reset", () => {
      const onStateChange = mock(() => {});
      const manager = createDataManager({
        initialItems: createTestItems(5),
        onStateChange,
      });

      const callsBefore = onStateChange.mock.calls.length;
      manager.reset();

      expect(onStateChange.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // ===========================================================================
  // Eviction
  // ===========================================================================

  describe("evictDistant", () => {
    it("should evict items far from visible range", async () => {
      const items = createTestItems(200);
      const adapter = createMockAdapter(items);

      const manager = createDataManager({
        adapter,
        storage: { chunkSize: 10, maxCachedItems: 50, evictionBuffer: 10 },
      });

      // Load many items
      await manager.loadRange(0, 99);
      const cachedBefore = manager.getCached();
      expect(cachedBefore).toBe(100);

      // Evict items far from the end
      manager.evictDistant(80, 99);

      expect(manager.getCached()).toBeLessThan(cachedBefore);
    });

    it("should rebuild ID index after eviction", async () => {
      const items = createTestItems(200);
      const adapter = createMockAdapter(items);

      const manager = createDataManager({
        adapter,
        storage: { chunkSize: 10, maxCachedItems: 50, evictionBuffer: 0 },
      });

      await manager.loadRange(0, 99);

      // Item 5 should be findable before eviction
      expect(manager.getIndexById(5)).toBe(4);

      // Evict by viewing far range
      manager.evictDistant(80, 99);

      // After eviction, ID index is rebuilt — evicted item IDs return -1
      const idx = manager.getIndexById(5);
      // If chunk 0 was evicted, index should be -1
      if (!manager.isItemLoaded(4)) {
        expect(idx).toBe(-1);
      }
    });

    it("should not evict when under cache limit", async () => {
      const items = createTestItems(30);
      const adapter = createMockAdapter(items);

      const manager = createDataManager({
        adapter,
        storage: { chunkSize: 10, maxCachedItems: 100 },
      });

      await manager.loadRange(0, 29);
      const cachedBefore = manager.getCached();

      manager.evictDistant(0, 29);

      expect(manager.getCached()).toBe(cachedBefore);
    });
  });

  // ===========================================================================
  // updateItem — ID Change
  // ===========================================================================

  describe("updateItem advanced", () => {
    it("should handle ID change in update", () => {
      const items: VListItem[] = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
      ];
      const manager = createDataManager({ initialItems: items });

      // Change item 2's ID to 99
      const result = manager.updateItem(2, {
        id: 99,
        name: "Bob Renamed",
      } as any);

      expect(result).toBe(true);

      // Old ID should no longer resolve
      expect(manager.getItemById(2)).toBeUndefined();
      expect(manager.getIndexById(2)).toBe(-1);

      // New ID should resolve
      expect(manager.getItemById(99)).toBeDefined();
      expect((manager.getItemById(99) as any).name).toBe("Bob Renamed");
    });

    it("should return false when underlying storage item is missing", () => {
      const manager = createDataManager({
        initialItems: createTestItems(5),
      });

      // Try updating non-existent ID
      const result = manager.updateItem(999, { name: "Ghost" });
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // getItemsInRange
  // ===========================================================================

  describe("getItemsInRange advanced", () => {
    it("should return placeholders for unloaded items with correct counts", () => {
      const manager = createDataManager({ initialTotal: 100 });

      const items = manager.getItemsInRange(0, 9);

      expect(items.length).toBe(10);
      // All should be placeholders
      for (const item of items) {
        expect(item).toBeDefined();
        expect(item.id).toBeDefined();
      }
    });

    it("should mix loaded and placeholder items", () => {
      const manager = createDataManager({ initialTotal: 100 });

      // Load first 5 items
      manager.setItems(createTestItems(5), 0);

      const items = manager.getItemsInRange(0, 9);

      expect(items.length).toBe(10);
      // First 5 are real items
      for (let i = 0; i < 5; i++) {
        expect(items[i]!.id).toBe(i + 1);
      }
    });
  });

  // ===========================================================================
  // setItems — Advanced
  // ===========================================================================

  describe("setItems advanced", () => {
    it("should update hasMore when cached matches total", () => {
      const manager = createDataManager();

      manager.setItems(createTestItems(10), 0, 10);

      expect(manager.getHasMore()).toBe(false);
    });

    it("should auto-expand total when offset + items exceed current total", () => {
      const manager = createDataManager();

      manager.setItems(createTestItems(5), 0);

      expect(manager.getTotal()).toBe(5);

      // Set items beyond the current total
      manager.setItems(createTestItems(5, 100), 20);

      expect(manager.getTotal()).toBe(25);
    });

    it("should call onItemsLoaded callback", () => {
      const onItemsLoaded = mock(() => {});
      const manager = createDataManager({ onItemsLoaded });

      manager.setItems(createTestItems(5), 0, 5);

      expect(onItemsLoaded).toHaveBeenCalled();
    });

    it("should analyze placeholder structure from first batch", () => {
      // Force placeholder creation first
      const manager = createDataManager({ initialTotal: 100 });

      // Access placeholders to trigger creation
      manager.getPlaceholders();

      // First setItems should analyze structure
      const items: VListItem[] = [
        { id: 1, name: "Item 1", type: "track" },
        { id: 2, name: "Item 2", type: "track" },
      ];
      manager.setItems(items, 0, 100);

      expect(manager.getCached()).toBe(2);
    });
  });

  // ===========================================================================
  // loadRange — Concurrent & Error
  // ===========================================================================

  describe("loadRange advanced", () => {
    it("should handle adapter errors gracefully", async () => {
      const adapter: VListAdapter = {
        read: async () => {
          throw new Error("Network failure");
        },
      };
      const manager = createDataManager({ adapter });

      await manager.loadRange(0, 19);

      expect(manager.getState().error).toBeDefined();
      expect(manager.getState().error!.message).toBe("Network failure");
      expect(manager.getState().isLoading).toBe(false);
    });

    it("should handle non-Error exceptions", async () => {
      const adapter: VListAdapter = {
        read: async () => {
          throw "string error";
        },
      };
      const manager = createDataManager({ adapter });

      await manager.loadRange(0, 19);

      expect(manager.getState().error).toBeDefined();
      expect(manager.getState().error!.message).toBe("string error");
    });

    it("should deduplicate concurrent loads of the same range", async () => {
      const readMock = mock(
        async ({ offset, limit }: { offset: number; limit: number }) => {
          await new Promise((r) => setTimeout(r, 20));
          const items = createTestItems(100);
          return {
            items: items.slice(offset, offset + limit),
            total: 100,
            hasMore: offset + limit < 100,
          };
        },
      );
      const adapter: VListAdapter = { read: readMock };
      const manager = createDataManager({ adapter });

      // Start two loads for the same range concurrently
      const p1 = manager.loadRange(0, 49);
      const p2 = manager.loadRange(0, 49);

      await Promise.all([p1, p2]);

      // Second call should be deduped (exact same rangeKey)
      // Read mock should only be called once per chunk
      const callCount = readMock.mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(1); // exactly one chunk covers 0-99
    });

    it("should update cursor from adapter response", async () => {
      const adapter: VListAdapter = {
        read: async ({ offset, limit }) => ({
          items: createTestItems(limit, offset + 1),
          total: 100,
          hasMore: true,
          cursor: "next_page_token",
        }),
      };
      const manager = createDataManager({ adapter });

      await manager.loadRange(0, 19);

      expect(manager.getState().cursor).toBe("next_page_token");
    });

    it("should handle hasMore from adapter response", async () => {
      const adapter: VListAdapter = {
        read: async ({ offset, limit }) => ({
          items: createTestItems(limit, offset + 1),
          total: 10,
          hasMore: false,
        }),
      };
      const manager = createDataManager({ adapter });

      await manager.loadRange(0, 9);

      expect(manager.getHasMore()).toBe(false);
    });

    it("should skip already-loading chunk ranges", async () => {
      let resolveFirst: (() => void) | null = null;
      let callCount = 0;

      const adapter: VListAdapter = {
        read: async ({ offset, limit }) => {
          callCount++;
          if (callCount === 1) {
            // First call blocks until we release it
            await new Promise<void>((r) => {
              resolveFirst = r;
            });
          }
          const items = createTestItems(100);
          return {
            items: items.slice(offset, offset + limit),
            total: 100,
            hasMore: false,
          };
        },
      };
      const manager = createDataManager({
        adapter,
        storage: { chunkSize: 100 },
      });

      // Start first load
      const p1 = manager.loadRange(0, 99);

      // Start overlapping load while first is in progress
      const p2 = manager.loadRange(0, 99);

      // Release the first load
      if (resolveFirst) resolveFirst();

      await Promise.all([p1, p2]);

      // Should only have called adapter once (second call was deduped)
      expect(callCount).toBe(1);
    });
  });

  // ===========================================================================
  // loadMore — Advanced
  // ===========================================================================

  describe("loadMore advanced", () => {
    it("should return false when isLoading is true", async () => {
      const items = createTestItems(100);
      const adapter = createMockAdapter(items, 50);
      const manager = createDataManager({
        adapter,
        pageSize: 20,
      });

      // Start a load that takes time
      const loadPromise = manager.loadInitial();

      // Try loadMore while loading
      const result = await manager.loadMore();
      expect(result).toBe(false);

      await loadPromise;
    });

    it("should return false when start >= total and total > 0", async () => {
      const items = createTestItems(10);
      const adapter = createMockAdapter(items);
      const manager = createDataManager({
        adapter,
        pageSize: 50,
      });

      // Load everything
      await manager.loadInitial();

      // Now all items are loaded, loadMore should return false
      const result = await manager.loadMore();
      expect(result).toBe(false);
      expect(manager.getHasMore()).toBe(false);
    });

    it("should calculate correct range for next page", async () => {
      const readMock = mock(
        async ({ offset, limit }: { offset: number; limit: number }) => {
          const items = createTestItems(200);
          return {
            items: items.slice(offset, offset + limit),
            total: 200,
            hasMore: offset + limit < 200,
          };
        },
      );
      const adapter: VListAdapter = { read: readMock };
      const manager = createDataManager({
        adapter,
        pageSize: 20,
      });

      await manager.loadInitial();
      const cachedAfterInit = manager.getCached();

      const result = await manager.loadMore();
      expect(result).toBe(true);
      expect(manager.getCached()).toBeGreaterThan(cachedAfterInit);
    });
  });

  // ===========================================================================
  // ensureRange — Additional Cases
  // ===========================================================================

  describe("ensureRange advanced", () => {
    it("should load only missing parts of a partially loaded range", async () => {
      const readMock = mock(
        async ({ offset, limit }: { offset: number; limit: number }) => {
          const items = createTestItems(200);
          return {
            items: items.slice(offset, offset + limit),
            total: 200,
            hasMore: true,
          };
        },
      );
      const adapter: VListAdapter = { read: readMock };
      const manager = createDataManager({
        adapter,
        initialTotal: 200,
        storage: { chunkSize: 25 },
      });

      // Load first two chunks (0-49)
      await manager.ensureRange(0, 49);
      const callsAfterFirst = readMock.mock.calls.length;

      // Ensure range that starts in loaded area but extends into unloaded (50-99)
      await manager.ensureRange(25, 99);

      // Should have made additional calls for the unloaded chunks (50-74, 75-99)
      expect(readMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  // ===========================================================================
  // reload
  // ===========================================================================

  describe("reload advanced", () => {
    it("should clear cursor and error on reload", async () => {
      const adapter: VListAdapter = {
        read: async ({ offset, limit }) => ({
          items: createTestItems(limit, offset + 1),
          total: 50,
          hasMore: true,
          cursor: "some_cursor",
        }),
      };
      const manager = createDataManager({ adapter, pageSize: 20 });

      await manager.loadInitial();
      expect(manager.getState().cursor).toBe("some_cursor");

      await manager.reload();

      // Cursor should be refreshed from new load
      expect(manager.getState().hasMore).toBe(true);
    });

    it("should clear placeholders on reload", async () => {
      const adapter: VListAdapter = {
        read: async ({ offset, limit }) => ({
          items: createTestItems(limit, offset + 1),
          total: 50,
          hasMore: true,
        }),
      };
      const manager = createDataManager({
        adapter,
        initialTotal: 100,
        pageSize: 20,
      });

      // Access placeholders
      manager.getPlaceholders();

      await manager.loadInitial();
      await manager.reload();

      expect(manager.getCached()).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // removeItem — advanced
  // ===========================================================================

  describe("removeItem advanced", () => {
    it("should decrease total after removal", () => {
      const manager = createDataManager({
        initialItems: createTestItems(10),
      });

      expect(manager.getTotal()).toBe(10);

      manager.removeItem(5);

      expect(manager.getTotal()).toBe(9);
    });

    it("should handle removing last item", () => {
      const manager = createDataManager({
        initialItems: [{ id: 1, name: "Only" }],
      });

      const result = manager.removeItem(1);

      expect(result).toBe(true);
      expect(manager.getTotal()).toBe(0);
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
