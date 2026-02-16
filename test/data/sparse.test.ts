/**
 * vlist - Sparse Storage Tests
 * Tests for the sparse array data structure used for virtual list items
 */

import { describe, it, expect, mock } from "bun:test";
import {
  createSparseStorage,
  mergeRanges,
  calculateMissingRanges,
} from "../../src/plugins/data/sparse";

import type { VListItem } from "../../src/types";

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createItem = (id: number): TestItem => ({
  id,
  name: `Item ${id}`,
});

const createItems = (count: number, startId: number = 1): TestItem[] =>
  Array.from({ length: count }, (_, i) => createItem(startId + i));

// =============================================================================
// Factory & Configuration
// =============================================================================

describe("createSparseStorage", () => {
  describe("factory", () => {
    it("should create storage with default config", () => {
      const storage = createSparseStorage();

      expect(storage.chunkSize).toBe(100);
      expect(storage.maxCachedItems).toBe(5000);
      expect(storage.getTotal()).toBe(0);
      expect(storage.getCachedCount()).toBe(0);
    });

    it("should create storage with custom chunk size", () => {
      const storage = createSparseStorage({ chunkSize: 50 });

      expect(storage.chunkSize).toBe(50);
    });

    it("should create storage with custom max cached items", () => {
      const storage = createSparseStorage({ maxCachedItems: 1000 });

      expect(storage.maxCachedItems).toBe(1000);
    });

    it("should create storage with custom eviction buffer", () => {
      // evictionBuffer is internal but affects evictDistant behavior
      const storage = createSparseStorage({ evictionBuffer: 500 });

      expect(storage).toBeDefined();
    });

    it("should accept onEvict callback", () => {
      const onEvict = mock(() => {});
      const storage = createSparseStorage({ onEvict });

      expect(storage).toBeDefined();
    });
  });

  // ===========================================================================
  // Total Management
  // ===========================================================================

  describe("total management", () => {
    it("should get and set total", () => {
      const storage = createSparseStorage();

      expect(storage.getTotal()).toBe(0);

      storage.setTotal(1000);
      expect(storage.getTotal()).toBe(1000);
    });

    it("should auto-expand total when setting item beyond current total", () => {
      const storage = createSparseStorage();

      storage.set(99, createItem(100));
      expect(storage.getTotal()).toBe(100);
    });

    it("should not shrink total when setting item within range", () => {
      const storage = createSparseStorage();

      storage.setTotal(500);
      storage.set(10, createItem(11));
      expect(storage.getTotal()).toBe(500);
    });
  });

  // ===========================================================================
  // Item Access — get
  // ===========================================================================

  describe("get", () => {
    it("should return undefined for empty storage", () => {
      const storage = createSparseStorage();
      storage.setTotal(100);

      expect(storage.get(0)).toBeUndefined();
      expect(storage.get(50)).toBeUndefined();
    });

    it("should return item after set", () => {
      const storage = createSparseStorage();
      const item = createItem(1);

      storage.set(0, item);

      expect(storage.get(0)).toEqual(item);
    });

    it("should return undefined for negative index", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.get(-1)).toBeUndefined();
    });

    it("should return undefined for index >= totalItems", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.get(10)).toBeUndefined();
      expect(storage.get(100)).toBeUndefined();
    });

    it("should return undefined for index in unloaded chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      // Set item in chunk 0, then query chunk 5
      storage.set(0, createItem(1));
      expect(storage.get(50)).toBeUndefined();
    });

    it("should return undefined for unset slot in existing chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      storage.set(0, createItem(1));
      // Index 5 is in chunk 0 but not set
      expect(storage.get(5)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Item Access — has
  // ===========================================================================

  describe("has", () => {
    it("should return false for empty storage", () => {
      const storage = createSparseStorage();
      storage.setTotal(100);

      expect(storage.has(0)).toBe(false);
    });

    it("should return true for set item", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));

      expect(storage.has(0)).toBe(true);
    });

    it("should return false for negative index", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.has(-1)).toBe(false);
    });

    it("should return false for index >= totalItems", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.has(10)).toBe(false);
      expect(storage.has(999)).toBe(false);
    });

    it("should return false for unloaded chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      storage.set(0, createItem(1));
      expect(storage.has(50)).toBe(false);
    });

    it("should return false for unset slot in existing chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      storage.set(0, createItem(1));
      expect(storage.has(5)).toBe(false);
    });
  });

  // ===========================================================================
  // Item Access — set
  // ===========================================================================

  describe("set", () => {
    it("should set and retrieve an item", () => {
      const storage = createSparseStorage();
      const item = createItem(1);

      storage.set(0, item);

      expect(storage.get(0)).toEqual(item);
      expect(storage.getCachedCount()).toBe(1);
    });

    it("should increment cached count for new items", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));
      expect(storage.getCachedCount()).toBe(1);

      storage.set(1, createItem(2));
      expect(storage.getCachedCount()).toBe(2);
    });

    it("should not increment cached count when overwriting", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));
      expect(storage.getCachedCount()).toBe(1);

      storage.set(0, createItem(99));
      expect(storage.getCachedCount()).toBe(1);
      expect(storage.get(0)!.id).toBe(99);
    });

    it("should expand total if index exceeds current total", () => {
      const storage = createSparseStorage();

      storage.set(499, createItem(500));

      expect(storage.getTotal()).toBe(500);
    });

    it("should set items across multiple chunks", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      storage.set(5, createItem(6));
      storage.set(15, createItem(16));
      storage.set(25, createItem(26));

      expect(storage.get(5)).toEqual(createItem(6));
      expect(storage.get(15)).toEqual(createItem(16));
      expect(storage.get(25)).toEqual(createItem(26));
      expect(storage.getCachedCount()).toBe(3);
    });
  });

  // ===========================================================================
  // setRange
  // ===========================================================================

  describe("setRange", () => {
    it("should set multiple items starting at offset", () => {
      const storage = createSparseStorage();
      const items = createItems(5);

      storage.setRange(0, items);

      expect(storage.getCachedCount()).toBe(5);
      expect(storage.get(0)).toEqual(items[0]);
      expect(storage.get(4)).toEqual(items[4]);
    });

    it("should set items at non-zero offset", () => {
      const storage = createSparseStorage();
      const items = createItems(3, 10);

      storage.setRange(10, items);

      expect(storage.get(10)).toEqual({ id: 10, name: "Item 10" });
      expect(storage.get(11)).toEqual({ id: 11, name: "Item 11" });
      expect(storage.get(12)).toEqual({ id: 12, name: "Item 12" });
      expect(storage.getCachedCount()).toBe(3);
    });

    it("should skip undefined items in the array", () => {
      const storage = createSparseStorage();
      const items: (TestItem | undefined)[] = [
        createItem(1),
        undefined,
        createItem(3),
      ];

      storage.setRange(0, items as TestItem[]);

      expect(storage.get(0)).toEqual(createItem(1));
      expect(storage.has(1)).toBe(false);
      expect(storage.get(2)).toEqual(createItem(3));
      expect(storage.getCachedCount()).toBe(2);
    });

    it("should set items spanning multiple chunks", () => {
      const storage = createSparseStorage({ chunkSize: 5 });
      const items = createItems(12);

      storage.setRange(0, items);

      expect(storage.getCachedCount()).toBe(12);
      for (let i = 0; i < 12; i++) {
        expect(storage.get(i)).toEqual(items[i]);
      }
    });

    it("should update total when items extend beyond current total", () => {
      const storage = createSparseStorage();
      const items = createItems(5);

      storage.setRange(100, items);

      expect(storage.getTotal()).toBe(105);
    });

    it("should handle empty array", () => {
      const storage = createSparseStorage();

      storage.setRange(0, []);

      expect(storage.getCachedCount()).toBe(0);
    });
  });

  // ===========================================================================
  // delete
  // ===========================================================================

  describe("delete", () => {
    it("should delete an existing item", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));
      expect(storage.has(0)).toBe(true);

      const result = storage.delete(0);

      expect(result).toBe(true);
      expect(storage.has(0)).toBe(false);
      expect(storage.getCachedCount()).toBe(0);
    });

    it("should return false for negative index", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.delete(-1)).toBe(false);
    });

    it("should return false for index >= totalItems", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      expect(storage.delete(10)).toBe(false);
      expect(storage.delete(999)).toBe(false);
    });

    it("should return false for unloaded chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      expect(storage.delete(50)).toBe(false);
    });

    it("should return false for already empty slot", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      storage.set(0, createItem(1));
      expect(storage.delete(5)).toBe(false);
    });

    it("should decrement cached count", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));
      storage.set(1, createItem(2));
      expect(storage.getCachedCount()).toBe(2);

      storage.delete(0);
      expect(storage.getCachedCount()).toBe(1);
    });

    it("should remove empty chunk after last item deleted", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      storage.set(0, createItem(1));
      expect(storage.isChunkLoaded(0)).toBe(true);

      storage.delete(0);
      expect(storage.isChunkLoaded(0)).toBe(false);
    });

    it("should keep chunk if other items remain", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      storage.set(0, createItem(1));
      storage.set(5, createItem(6));

      storage.delete(0);

      expect(storage.isChunkLoaded(0)).toBe(true);
      expect(storage.get(5)).toEqual(createItem(6));
    });
  });

  // ===========================================================================
  // getRange
  // ===========================================================================

  describe("getRange", () => {
    it("should return items in range", () => {
      const storage = createSparseStorage();
      const items = createItems(10);

      storage.setRange(0, items);

      const range = storage.getRange(0, 4);

      expect(range.length).toBe(5);
      expect(range[0]).toEqual(items[0]);
      expect(range[4]).toEqual(items[4]);
    });

    it("should return undefined for unloaded items in range", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      storage.set(0, createItem(1));
      storage.set(4, createItem(5));

      const range = storage.getRange(0, 4);

      expect(range.length).toBe(5);
      expect(range[0]).toEqual(createItem(1));
      expect(range[1]).toBeUndefined();
      expect(range[2]).toBeUndefined();
      expect(range[3]).toBeUndefined();
      expect(range[4]).toEqual(createItem(5));
    });

    it("should clamp to total items", () => {
      const storage = createSparseStorage();
      const items = createItems(5);
      storage.setRange(0, items);

      const range = storage.getRange(0, 100);

      expect(range.length).toBe(5);
    });

    it("should return empty array when start >= totalItems", () => {
      const storage = createSparseStorage();
      storage.setTotal(5);

      const range = storage.getRange(10, 20);

      expect(range.length).toBe(0);
    });

    it("should handle range within a single chunk", () => {
      const storage = createSparseStorage({ chunkSize: 100 });
      const items = createItems(50);
      storage.setRange(0, items);

      const range = storage.getRange(10, 20);

      expect(range.length).toBe(11);
      for (let i = 0; i < range.length; i++) {
        expect(range[i]).toEqual(items[10 + i]);
      }
    });

    it("should handle range spanning multiple chunks", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      const items = createItems(30);
      storage.setRange(0, items);

      const range = storage.getRange(5, 25);

      expect(range.length).toBe(21);
      for (let i = 0; i < range.length; i++) {
        expect(range[i]).toEqual(items[5 + i]);
      }
    });
  });

  // ===========================================================================
  // isRangeLoaded
  // ===========================================================================

  describe("isRangeLoaded", () => {
    it("should return true when entire range is loaded", () => {
      const storage = createSparseStorage();
      const items = createItems(10);
      storage.setRange(0, items);

      expect(storage.isRangeLoaded(0, 9)).toBe(true);
    });

    it("should return false when range has gaps", () => {
      const storage = createSparseStorage();
      storage.setTotal(10);

      storage.set(0, createItem(1));
      storage.set(9, createItem(10));

      expect(storage.isRangeLoaded(0, 9)).toBe(false);
    });

    it("should return true for single loaded item", () => {
      const storage = createSparseStorage();

      storage.set(5, createItem(6));

      expect(storage.isRangeLoaded(5, 5)).toBe(true);
    });

    it("should return true when end > total (checks up to total)", () => {
      const storage = createSparseStorage();
      const items = createItems(5);
      storage.setRange(0, items);

      // Range 0..100 but only 5 items exist — should check 0..4
      expect(storage.isRangeLoaded(0, 100)).toBe(true);
    });

    it("should return true for empty total (vacuously true)", () => {
      const storage = createSparseStorage();

      expect(storage.isRangeLoaded(0, 10)).toBe(true);
    });
  });

  // ===========================================================================
  // getLoadedRanges
  // ===========================================================================

  describe("getLoadedRanges", () => {
    it("should return empty array for empty storage", () => {
      const storage = createSparseStorage();
      storage.setTotal(100);

      expect(storage.getLoadedRanges()).toEqual([]);
    });

    it("should return single range for contiguous items", () => {
      const storage = createSparseStorage();
      const items = createItems(10);
      storage.setRange(0, items);

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(1);
      expect(ranges[0]).toEqual({ start: 0, end: 9 });
    });

    it("should return multiple ranges for non-contiguous items", () => {
      const storage = createSparseStorage({ chunkSize: 100 });
      storage.setTotal(100);

      // Set items 0-4 and 10-14
      for (let i = 0; i < 5; i++) {
        storage.set(i, createItem(i + 1));
      }
      for (let i = 10; i < 15; i++) {
        storage.set(i, createItem(i + 1));
      }

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(2);
      expect(ranges[0]).toEqual({ start: 0, end: 4 });
      expect(ranges[1]).toEqual({ start: 10, end: 14 });
    });

    it("should handle items scattered across chunks", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(100);

      // Set items at chunk boundaries
      storage.set(0, createItem(1));
      storage.set(10, createItem(11));
      storage.set(20, createItem(21));

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(3);
      expect(ranges[0]).toEqual({ start: 0, end: 0 });
      expect(ranges[1]).toEqual({ start: 10, end: 10 });
      expect(ranges[2]).toEqual({ start: 20, end: 20 });
    });

    it("should handle contiguous items spanning chunks", () => {
      const storage = createSparseStorage({ chunkSize: 5 });
      storage.setTotal(20);

      // Fill items 3-7 (spans chunk 0 and chunk 1)
      for (let i = 3; i <= 7; i++) {
        storage.set(i, createItem(i + 1));
      }

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(1);
      expect(ranges[0]).toEqual({ start: 3, end: 7 });
    });

    it("should respect totalItems boundary", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      // Set 3 items, total is 3
      storage.set(0, createItem(1));
      storage.set(1, createItem(2));
      storage.set(2, createItem(3));

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(1);
      expect(ranges[0]).toEqual({ start: 0, end: 2 });
    });

    it("should handle gaps within a single chunk", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(10);

      storage.set(0, createItem(1));
      storage.set(2, createItem(3));
      storage.set(4, createItem(5));

      const ranges = storage.getLoadedRanges();

      expect(ranges.length).toBe(3);
      expect(ranges[0]).toEqual({ start: 0, end: 0 });
      expect(ranges[1]).toEqual({ start: 2, end: 2 });
      expect(ranges[2]).toEqual({ start: 4, end: 4 });
    });
  });

  // ===========================================================================
  // findUnloadedRanges
  // ===========================================================================

  describe("findUnloadedRanges", () => {
    it("should return entire range when nothing is loaded", () => {
      const storage = createSparseStorage();
      storage.setTotal(100);

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 0, end: 19 });
    });

    it("should return empty array when range is fully loaded", () => {
      const storage = createSparseStorage();
      const items = createItems(20);
      storage.setRange(0, items);

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(0);
    });

    it("should find gap at the start", () => {
      const storage = createSparseStorage();
      storage.setTotal(20);

      // Load items 5-19
      for (let i = 5; i < 20; i++) {
        storage.set(i, createItem(i + 1));
      }

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 0, end: 4 });
    });

    it("should find gap at the end", () => {
      const storage = createSparseStorage();
      storage.setTotal(20);

      // Load items 0-9
      for (let i = 0; i < 10; i++) {
        storage.set(i, createItem(i + 1));
      }

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 10, end: 19 });
    });

    it("should find gap in the middle", () => {
      const storage = createSparseStorage();
      storage.setTotal(20);

      // Load items 0-4 and 15-19
      for (let i = 0; i < 5; i++) {
        storage.set(i, createItem(i + 1));
      }
      for (let i = 15; i < 20; i++) {
        storage.set(i, createItem(i + 1));
      }

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 5, end: 14 });
    });

    it("should find multiple gaps", () => {
      const storage = createSparseStorage();
      storage.setTotal(20);

      // Load items 0-2, 7-9, 17-19
      for (let i = 0; i <= 2; i++) storage.set(i, createItem(i + 1));
      for (let i = 7; i <= 9; i++) storage.set(i, createItem(i + 1));
      for (let i = 17; i <= 19; i++) storage.set(i, createItem(i + 1));

      const unloaded = storage.findUnloadedRanges(0, 19);

      expect(unloaded.length).toBe(2);
      expect(unloaded[0]).toEqual({ start: 3, end: 6 });
      expect(unloaded[1]).toEqual({ start: 10, end: 16 });
    });

    it("should clamp to totalItems", () => {
      const storage = createSparseStorage();
      storage.setTotal(5);

      const unloaded = storage.findUnloadedRanges(0, 100);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 0, end: 4 });
    });

    it("should handle single unloaded item", () => {
      const storage = createSparseStorage();
      storage.setTotal(5);

      storage.set(0, createItem(1));
      storage.set(2, createItem(3));
      storage.set(3, createItem(4));
      storage.set(4, createItem(5));

      const unloaded = storage.findUnloadedRanges(0, 4);

      expect(unloaded.length).toBe(1);
      expect(unloaded[0]).toEqual({ start: 1, end: 1 });
    });
  });

  // ===========================================================================
  // Chunk Operations
  // ===========================================================================

  describe("chunk operations", () => {
    describe("getChunkIndex", () => {
      it("should return correct chunk index", () => {
        const storage = createSparseStorage({ chunkSize: 10 });

        expect(storage.getChunkIndex(0)).toBe(0);
        expect(storage.getChunkIndex(9)).toBe(0);
        expect(storage.getChunkIndex(10)).toBe(1);
        expect(storage.getChunkIndex(99)).toBe(9);
        expect(storage.getChunkIndex(100)).toBe(10);
      });

      it("should work with default chunk size", () => {
        const storage = createSparseStorage();

        expect(storage.getChunkIndex(0)).toBe(0);
        expect(storage.getChunkIndex(99)).toBe(0);
        expect(storage.getChunkIndex(100)).toBe(1);
      });
    });

    describe("isChunkLoaded", () => {
      it("should return false for unloaded chunk", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.setTotal(100);

        expect(storage.isChunkLoaded(0)).toBe(false);
        expect(storage.isChunkLoaded(5)).toBe(false);
      });

      it("should return true after setting item in chunk", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.setTotal(100);

        storage.set(0, createItem(1));

        expect(storage.isChunkLoaded(0)).toBe(true);
        expect(storage.isChunkLoaded(1)).toBe(false);
      });

      it("should return false after chunk is emptied", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.setTotal(100);

        storage.set(0, createItem(1));
        expect(storage.isChunkLoaded(0)).toBe(true);

        storage.delete(0);
        expect(storage.isChunkLoaded(0)).toBe(false);
      });
    });

    describe("touchChunk", () => {
      it("should not throw for existing chunk", () => {
        const storage = createSparseStorage({ chunkSize: 10 });

        storage.set(0, createItem(1));

        // Should not throw
        storage.touchChunk(0);
      });

      it("should not throw for non-existing chunk", () => {
        const storage = createSparseStorage({ chunkSize: 10 });

        // Should not throw (no-op for non-existing chunks)
        storage.touchChunk(99);
      });
    });

    describe("touchChunksForRange", () => {
      it("should touch all chunks covering a range", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.setTotal(100);

        // Set items in chunks 0, 1, 2
        storage.set(5, createItem(6));
        storage.set(15, createItem(16));
        storage.set(25, createItem(26));

        // Should not throw — marks chunks as recently accessed
        storage.touchChunksForRange(0, 29);
      });

      it("should handle empty storage", () => {
        const storage = createSparseStorage({ chunkSize: 10 });

        // Should not throw with empty chunks map
        storage.touchChunksForRange(0, 100);
      });

      it("should handle start > end", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.set(0, createItem(1));

        // Should early return for invalid range
        storage.touchChunksForRange(10, 0);
      });

      it("should clamp to valid range", () => {
        const storage = createSparseStorage({ chunkSize: 10 });
        storage.setTotal(50);

        storage.set(0, createItem(1));
        storage.set(45, createItem(46));

        // Should not throw, clamps end to totalItems - 1
        storage.touchChunksForRange(0, 100);
      });
    });
  });

  // ===========================================================================
  // Eviction — evictDistant
  // ===========================================================================

  describe("evictDistant", () => {
    it("should not evict when under cache limit", () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 100,
      });
      const items = createItems(50);
      storage.setRange(0, items);

      const evicted = storage.evictDistant(0, 49);

      expect(evicted).toBe(0);
      expect(storage.getCachedCount()).toBe(50);
    });

    it("should evict chunks far from visible range", () => {
      const onEvict = mock(() => {});
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 50,
        evictionBuffer: 10,
        onEvict,
      });

      // Load 80 items (exceeds maxCachedItems of 50)
      const items = createItems(80);
      storage.setRange(0, items);

      expect(storage.getCachedCount()).toBe(80);

      // Viewing items around index 60-70 — chunks 0-3 are far away
      const evicted = storage.evictDistant(60, 70);

      expect(evicted).toBeGreaterThan(0);
      expect(storage.getCachedCount()).toBeLessThan(80);
      expect(onEvict).toHaveBeenCalled();
    });

    it("should keep items within eviction buffer", () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 30,
        evictionBuffer: 20,
      });

      // Load 60 items
      const items = createItems(60);
      storage.setRange(0, items);

      // View items 25-35, buffer=20 → keep chunks covering 5-55
      storage.evictDistant(25, 35);

      // Items near visible range should still be accessible
      expect(storage.has(25)).toBe(true);
      expect(storage.has(30)).toBe(true);
      expect(storage.has(35)).toBe(true);
    });

    it("should call onEvict callback with count and ranges", () => {
      const onEvict = mock((_count: number, _ranges: number[]) => {});
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 20,
        evictionBuffer: 0,
        onEvict,
      });

      // Load 40 items across chunks 0-3
      const items = createItems(40);
      storage.setRange(0, items);

      // View items 30-39 (chunk 3) — chunks 0-2 should be evicted
      const evicted = storage.evictDistant(30, 39);

      expect(evicted).toBeGreaterThan(0);
      expect(onEvict).toHaveBeenCalledTimes(1);

      const [count, ranges] = onEvict.mock.calls[0]!;
      expect(count).toBeGreaterThan(0);
      expect(Array.isArray(ranges)).toBe(true);
    });

    it("should not call onEvict when nothing is evicted", () => {
      const onEvict = mock(() => {});
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 100,
        onEvict,
      });

      storage.setRange(0, createItems(10));
      storage.evictDistant(0, 9);

      expect(onEvict).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Eviction — evictToLimit
  // ===========================================================================

  describe("evictToLimit", () => {
    it("should not evict when under limit", () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 100,
      });

      storage.setRange(0, createItems(50));

      const evicted = storage.evictToLimit();

      expect(evicted).toBe(0);
      expect(storage.getCachedCount()).toBe(50);
    });

    it("should evict oldest chunks first (LRU)", () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 20,
      });

      // Load 40 items
      storage.setRange(0, createItems(40));

      expect(storage.getCachedCount()).toBe(40);

      const evicted = storage.evictToLimit();

      expect(evicted).toBeGreaterThan(0);
      expect(storage.getCachedCount()).toBeLessThanOrEqual(20);
    });

    it("should call onEvict callback", () => {
      const onEvict = mock((_count: number, _ranges: number[]) => {});
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 20,
        onEvict,
      });

      storage.setRange(0, createItems(40));
      storage.evictToLimit();

      expect(onEvict).toHaveBeenCalledTimes(1);

      const [count, ranges] = onEvict.mock.calls[0]!;
      expect(count).toBeGreaterThan(0);
      expect(Array.isArray(ranges)).toBe(true);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("should not call onEvict when nothing evicted", () => {
      const onEvict = mock(() => {});
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 100,
        onEvict,
      });

      storage.setRange(0, createItems(10));
      storage.evictToLimit();

      expect(onEvict).not.toHaveBeenCalled();
    });

    it("should respect LRU order via touchChunk", async () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 20,
      });

      // Load 30 items across chunks 0, 1, 2
      storage.setRange(0, createItems(30));

      // Touch chunk 0 to make it "recently used"
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5));
      storage.touchChunk(0);

      const evicted = storage.evictToLimit();

      expect(evicted).toBeGreaterThan(0);
      expect(storage.getCachedCount()).toBeLessThanOrEqual(20);

      // Chunk 0 was recently touched, so it should survive eviction
      // and older chunks (1 or 2) should be evicted first
      expect(storage.has(0)).toBe(true);
    });
  });

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe("getStats", () => {
    it("should return correct stats for empty storage", () => {
      const storage = createSparseStorage({
        chunkSize: 50,
        maxCachedItems: 2000,
      });

      const stats = storage.getStats();

      expect(stats.totalItems).toBe(0);
      expect(stats.cachedItems).toBe(0);
      expect(stats.cachedChunks).toBe(0);
      expect(stats.chunkSize).toBe(50);
      expect(stats.maxCachedItems).toBe(2000);
      expect(stats.memoryEfficiency).toBe(1); // 0 total → efficiency = 1
    });

    it("should return correct stats after adding items", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      storage.setTotal(1000);
      storage.setRange(0, createItems(50));

      const stats = storage.getStats();

      expect(stats.totalItems).toBe(1000);
      expect(stats.cachedItems).toBe(50);
      expect(stats.cachedChunks).toBe(5);
      expect(stats.chunkSize).toBe(10);
      expect(stats.memoryEfficiency).toBe(1 - 50 / 1000); // 0.95
    });

    it("should return correct memory efficiency", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      storage.setTotal(100);
      storage.setRange(0, createItems(100));

      const stats = storage.getStats();

      // 100 cached out of 100 total → efficiency = 0
      expect(stats.memoryEfficiency).toBe(0);
    });
  });

  describe("getCachedCount", () => {
    it("should return 0 for empty storage", () => {
      const storage = createSparseStorage();

      expect(storage.getCachedCount()).toBe(0);
    });

    it("should track additions and deletions", () => {
      const storage = createSparseStorage();

      storage.set(0, createItem(1));
      storage.set(1, createItem(2));
      expect(storage.getCachedCount()).toBe(2);

      storage.delete(0);
      expect(storage.getCachedCount()).toBe(1);
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe("lifecycle", () => {
    describe("clear", () => {
      it("should clear all data but keep total", () => {
        const storage = createSparseStorage();

        storage.setTotal(1000);
        storage.setRange(0, createItems(50));

        storage.clear();

        expect(storage.getCachedCount()).toBe(0);
        expect(storage.getTotal()).toBe(1000); // total preserved
        expect(storage.has(0)).toBe(false);
      });

      it("should clear all chunks", () => {
        const storage = createSparseStorage({ chunkSize: 10 });

        storage.setRange(0, createItems(30));

        expect(storage.isChunkLoaded(0)).toBe(true);
        expect(storage.isChunkLoaded(1)).toBe(true);
        expect(storage.isChunkLoaded(2)).toBe(true);

        storage.clear();

        expect(storage.isChunkLoaded(0)).toBe(false);
        expect(storage.isChunkLoaded(1)).toBe(false);
        expect(storage.isChunkLoaded(2)).toBe(false);
      });
    });

    describe("reset", () => {
      it("should reset to initial state", () => {
        const storage = createSparseStorage();

        storage.setTotal(1000);
        storage.setRange(0, createItems(50));

        storage.reset();

        expect(storage.getCachedCount()).toBe(0);
        expect(storage.getTotal()).toBe(0); // total also reset
        expect(storage.has(0)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Integration & Edge Cases
  // ===========================================================================

  describe("integration", () => {
    it("should handle set-get-delete cycle", () => {
      const storage = createSparseStorage({ chunkSize: 5 });
      const item = createItem(42);

      storage.set(10, item);
      expect(storage.get(10)).toEqual(item);

      storage.delete(10);
      expect(storage.get(10)).toBeUndefined();
    });

    it("should handle large number of items across many chunks", () => {
      const storage = createSparseStorage({ chunkSize: 100 });
      const items = createItems(500);

      storage.setRange(0, items);

      expect(storage.getCachedCount()).toBe(500);
      expect(storage.get(0)).toEqual(items[0]);
      expect(storage.get(499)).toEqual(items[499]);

      const stats = storage.getStats();
      expect(stats.cachedChunks).toBe(5);
    });

    it("should handle sparse loading pattern", () => {
      const storage = createSparseStorage({ chunkSize: 10 });
      storage.setTotal(1000);

      // Load scattered pages like a virtual scroll would
      storage.setRange(0, createItems(10, 1));
      storage.setRange(500, createItems(10, 501));
      storage.setRange(990, createItems(10, 991));

      expect(storage.getCachedCount()).toBe(30);
      expect(storage.has(0)).toBe(true);
      expect(storage.has(500)).toBe(true);
      expect(storage.has(990)).toBe(true);
      expect(storage.has(100)).toBe(false);

      const ranges = storage.getLoadedRanges();
      expect(ranges.length).toBe(3);
    });

    it("should handle rapid set and overwrite", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      for (let round = 0; round < 5; round++) {
        const items = createItems(10, round * 100);
        storage.setRange(0, items);
      }

      // Only 10 items should be cached (all overwrites at same indices)
      expect(storage.getCachedCount()).toBe(10);
    });

    it("should handle clear followed by re-population", () => {
      const storage = createSparseStorage({ chunkSize: 10 });

      storage.setRange(0, createItems(20));
      expect(storage.getCachedCount()).toBe(20);

      storage.clear();
      expect(storage.getCachedCount()).toBe(0);

      storage.setRange(0, createItems(10));
      expect(storage.getCachedCount()).toBe(10);
    });

    it("should handle eviction then re-load pattern", () => {
      const storage = createSparseStorage({
        chunkSize: 10,
        maxCachedItems: 20,
        evictionBuffer: 0,
      });

      // Load 40 items
      storage.setRange(0, createItems(40));
      expect(storage.getCachedCount()).toBe(40);

      // Evict distant items while viewing 30-39
      storage.evictDistant(30, 39);
      const afterEvict = storage.getCachedCount();
      expect(afterEvict).toBeLessThan(40);

      // Re-load evicted items
      storage.setRange(0, createItems(10));

      expect(storage.getCachedCount()).toBeGreaterThan(afterEvict);
    });
  });
});

// =============================================================================
// Utility Functions (re-test coverage from sparse.ts exports)
// These are also tested in data/index.test.ts but we add sparse-specific cases
// =============================================================================

describe("mergeRanges (sparse module)", () => {
  it("should handle three overlapping ranges", () => {
    const merged = mergeRanges([
      { start: 0, end: 5 },
      { start: 3, end: 8 },
      { start: 7, end: 12 },
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0]).toEqual({ start: 0, end: 12 });
  });

  it("should handle touching ranges (adjacent)", () => {
    const merged = mergeRanges([
      { start: 0, end: 9 },
      { start: 10, end: 19 },
      { start: 20, end: 29 },
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0]).toEqual({ start: 0, end: 29 });
  });

  it("should not mutate input array", () => {
    const input = [
      { start: 10, end: 20 },
      { start: 0, end: 5 },
    ];
    const inputCopy = [...input.map((r) => ({ ...r }))];

    mergeRanges(input);

    expect(input).toEqual(inputCopy);
  });

  it("should handle ranges with identical start/end", () => {
    const merged = mergeRanges([
      { start: 5, end: 5 },
      { start: 5, end: 5 },
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0]).toEqual({ start: 5, end: 5 });
  });

  it("should handle contained ranges", () => {
    const merged = mergeRanges([
      { start: 0, end: 100 },
      { start: 10, end: 20 },
      { start: 50, end: 60 },
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0]).toEqual({ start: 0, end: 100 });
  });
});

describe("calculateMissingRanges (sparse module)", () => {
  it("should handle loaded range that starts before needed range", () => {
    const missing = calculateMissingRanges(
      { start: 50, end: 99 },
      [{ start: 0, end: 49 }],
      50,
    );

    expect(missing.length).toBe(1);
    expect(missing[0]).toEqual({ start: 50, end: 99 });
  });

  it("should return empty when loaded range covers needed range", () => {
    const missing = calculateMissingRanges(
      { start: 10, end: 20 },
      [{ start: 0, end: 99 }],
      10,
    );

    expect(missing.length).toBe(0);
  });

  it("should align to chunk boundaries", () => {
    const missing = calculateMissingRanges({ start: 13, end: 27 }, [], 10);

    // aligned: start = floor(13/10)*10 = 10, end = ceil(28/10)*10 - 1 = 29
    expect(missing.length).toBe(1);
    expect(missing[0]).toEqual({ start: 10, end: 29 });
  });

  it("should handle multiple loaded ranges with gaps", () => {
    const missing = calculateMissingRanges(
      { start: 0, end: 99 },
      [
        { start: 0, end: 19 },
        { start: 40, end: 59 },
        { start: 80, end: 99 },
      ],
      20,
    );

    expect(missing.length).toBe(2);
    expect(missing[0]).toEqual({ start: 20, end: 39 });
    expect(missing[1]).toEqual({ start: 60, end: 79 });
  });

  it("should handle loaded range ending after needed range", () => {
    const missing = calculateMissingRanges(
      { start: 0, end: 49 },
      [
        { start: 0, end: 19 },
        { start: 30, end: 99 }, // extends past needed.end
      ],
      10,
    );

    expect(missing.length).toBe(1);
    expect(missing[0]).toEqual({ start: 20, end: 29 });
  });

  it("should skip loaded ranges that end before current position", () => {
    // loaded range [0, 5] ends before aligned start of needed [20, 29]
    const missing = calculateMissingRanges(
      { start: 20, end: 29 },
      [{ start: 0, end: 5 }],
      10,
    );

    expect(missing.length).toBe(1);
    expect(missing[0]).toEqual({ start: 20, end: 29 });
  });
});
