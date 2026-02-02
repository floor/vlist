/**
 * vlist - Sparse Storage
 * Efficient storage for million+ item virtual lists
 */

import type { VListItem, Range } from "../types";

// =============================================================================
// Types
// =============================================================================

/** Configuration for sparse storage */
export interface SparseStorageConfig {
  /** Number of items per chunk (default: 100) */
  chunkSize?: number;

  /** Maximum items to keep in memory (default: 5000) */
  maxCachedItems?: number;

  /** Extra items to keep around visible range during eviction (default: 200) */
  evictionBuffer?: number;

  /** Callback when items are evicted */
  onEvict?: (evictedCount: number, evictedRanges: number[]) => void;
}

/** Chunk of items */
interface Chunk<T> {
  /** Items in this chunk (sparse - may have undefined slots) */
  items: (T | undefined)[];

  /** Number of actual items in chunk */
  count: number;

  /** Last access timestamp for LRU eviction */
  lastAccess: number;
}

/** Storage statistics */
export interface SparseStorageStats {
  /** Total items declared (may be larger than loaded) */
  totalItems: number;

  /** Number of items currently in memory */
  cachedItems: number;

  /** Number of chunks in memory */
  cachedChunks: number;

  /** Chunk size */
  chunkSize: number;

  /** Maximum cached items allowed */
  maxCachedItems: number;

  /** Memory efficiency (cachedItems / totalItems) */
  memoryEfficiency: number;
}

/** Sparse storage instance */
export interface SparseStorage<T extends VListItem = VListItem> {
  // Configuration
  readonly chunkSize: number;
  readonly maxCachedItems: number;

  // Total management
  /** Get total item count */
  getTotal: () => number;

  /** Set total item count (for virtual scrolling height) */
  setTotal: (total: number) => void;

  // Item access
  /** Get item at index (undefined if not loaded) */
  get: (index: number) => T | undefined;

  /** Check if item at index is loaded */
  has: (index: number) => boolean;

  /** Set item at index */
  set: (index: number, item: T) => void;

  /** Set multiple items starting at offset */
  setRange: (offset: number, items: T[]) => void;

  /** Delete item at index */
  delete: (index: number) => boolean;

  // Range operations
  /** Get items in range (includes undefined for unloaded) */
  getRange: (start: number, end: number) => (T | undefined)[];

  /** Check if range is fully loaded */
  isRangeLoaded: (start: number, end: number) => boolean;

  /** Get loaded ranges */
  getLoadedRanges: () => Range[];

  /** Find unloaded ranges within a given range */
  findUnloadedRanges: (start: number, end: number) => Range[];

  // Chunk operations
  /** Get chunk index for item index */
  getChunkIndex: (itemIndex: number) => number;

  /** Check if chunk is loaded */
  isChunkLoaded: (chunkIndex: number) => boolean;

  /** Mark chunk as accessed (for LRU) */
  touchChunk: (chunkIndex: number) => void;

  // Eviction
  /** Evict chunks far from visible range */
  evictDistant: (visibleStart: number, visibleEnd: number) => number;

  /** Force eviction to meet memory limit */
  evictToLimit: () => number;

  // Statistics
  /** Get storage statistics */
  getStats: () => SparseStorageStats;

  /** Get cached item count */
  getCachedCount: () => number;

  // Lifecycle
  /** Clear all data */
  clear: () => void;

  /** Reset to initial state */
  reset: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CHUNK_SIZE = 100;
const DEFAULT_MAX_CACHED_ITEMS = 5000;
const DEFAULT_EVICTION_BUFFER = 200;

// =============================================================================
// Sparse Storage Implementation
// =============================================================================

/**
 * Create sparse storage for efficient large list handling
 */
export const createSparseStorage = <T extends VListItem = VListItem>(
  config: SparseStorageConfig = {},
): SparseStorage<T> => {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxCachedItems = DEFAULT_MAX_CACHED_ITEMS,
    evictionBuffer = DEFAULT_EVICTION_BUFFER,
    onEvict,
  } = config;

  // Storage state
  const chunks = new Map<number, Chunk<T>>();
  let totalItems = 0;
  let cachedItemCount = 0;

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Get or create a chunk
   */
  const getOrCreateChunk = (chunkIndex: number): Chunk<T> => {
    let chunk = chunks.get(chunkIndex);

    if (!chunk) {
      chunk = {
        items: new Array(chunkSize),
        count: 0,
        lastAccess: Date.now(),
      };
      chunks.set(chunkIndex, chunk);
    } else {
      chunk.lastAccess = Date.now();
    }

    return chunk;
  };

  /**
   * Get chunk index for item index
   */
  const getChunkIndex = (itemIndex: number): number => {
    return Math.floor(itemIndex / chunkSize);
  };

  /**
   * Get index within chunk
   */
  const getIndexInChunk = (itemIndex: number): number => {
    return itemIndex % chunkSize;
  };

  // ==========================================================================
  // Total Management
  // ==========================================================================

  const getTotal = (): number => totalItems;

  const setTotal = (total: number): void => {
    totalItems = total;
  };

  // ==========================================================================
  // Item Access
  // ==========================================================================

  const get = (index: number): T | undefined => {
    if (index < 0 || index >= totalItems) {
      return undefined;
    }

    const chunkIndex = getChunkIndex(index);
    const chunk = chunks.get(chunkIndex);

    if (!chunk) {
      // log(`get: index=${index}, chunkIndex=${chunkIndex} - chunk not found`);
      return undefined;
    }

    // Update access time for LRU
    chunk.lastAccess = Date.now();

    return chunk.items[getIndexInChunk(index)];
  };

  const has = (index: number): boolean => {
    if (index < 0 || index >= totalItems) {
      return false;
    }

    const chunkIndex = getChunkIndex(index);
    const chunk = chunks.get(chunkIndex);

    if (!chunk) {
      return false;
    }

    return chunk.items[getIndexInChunk(index)] !== undefined;
  };

  const set = (index: number, item: T): void => {
    const chunkIndex = getChunkIndex(index);
    const chunk = getOrCreateChunk(chunkIndex);
    const indexInChunk = getIndexInChunk(index);

    // Track if this is a new item
    const isNew = chunk.items[indexInChunk] === undefined;

    chunk.items[indexInChunk] = item;

    if (isNew) {
      chunk.count++;
      cachedItemCount++;
      // log(
      //   `set: index=${index}, chunkIndex=${chunkIndex}, cachedItemCount=${cachedItemCount}`,
      // );
    }

    // Update total if needed
    if (index >= totalItems) {
      totalItems = index + 1;
    }
  };

  const setRange = (offset: number, items: T[]): void => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item !== undefined) {
        set(offset + i, item);
      }
    }
  };

  const deleteItem = (index: number): boolean => {
    if (index < 0 || index >= totalItems) {
      return false;
    }

    const chunkIndex = getChunkIndex(index);
    const chunk = chunks.get(chunkIndex);

    if (!chunk) {
      return false;
    }

    const indexInChunk = getIndexInChunk(index);

    if (chunk.items[indexInChunk] === undefined) {
      return false;
    }

    chunk.items[indexInChunk] = undefined;
    chunk.count--;
    cachedItemCount--;

    // Remove chunk if empty
    if (chunk.count === 0) {
      chunks.delete(chunkIndex);
    }

    return true;
  };

  // ==========================================================================
  // Range Operations
  // ==========================================================================

  const getRange = (start: number, end: number): (T | undefined)[] => {
    const result: (T | undefined)[] = [];

    for (let i = start; i <= end && i < totalItems; i++) {
      result.push(get(i));
    }

    return result;
  };

  const isRangeLoaded = (start: number, end: number): boolean => {
    for (let i = start; i <= end && i < totalItems; i++) {
      if (!has(i)) {
        return false;
      }
    }
    return true;
  };

  const getLoadedRanges = (): Range[] => {
    const ranges: Range[] = [];
    let currentRange: Range | null = null;

    // Iterate through all chunks in order
    const sortedChunkIndices = Array.from(chunks.keys()).sort((a, b) => a - b);

    for (const chunkIndex of sortedChunkIndices) {
      const chunk = chunks.get(chunkIndex);
      if (!chunk) continue;

      const chunkStart = chunkIndex * chunkSize;

      // Find loaded items in this chunk
      for (let i = 0; i < chunkSize; i++) {
        const itemIndex = chunkStart + i;
        if (itemIndex >= totalItems) break;

        if (chunk.items[i] !== undefined) {
          if (currentRange === null) {
            currentRange = { start: itemIndex, end: itemIndex };
          } else if (itemIndex === currentRange.end + 1) {
            currentRange.end = itemIndex;
          } else {
            ranges.push(currentRange);
            currentRange = { start: itemIndex, end: itemIndex };
          }
        } else if (currentRange !== null) {
          ranges.push(currentRange);
          currentRange = null;
        }
      }
    }

    if (currentRange !== null) {
      ranges.push(currentRange);
    }

    return ranges;
  };

  const findUnloadedRanges = (start: number, end: number): Range[] => {
    const unloaded: Range[] = [];
    let currentRange: Range | null = null;

    for (let i = start; i <= end && i < totalItems; i++) {
      if (!has(i)) {
        if (currentRange === null) {
          currentRange = { start: i, end: i };
        } else {
          currentRange.end = i;
        }
      } else if (currentRange !== null) {
        unloaded.push(currentRange);
        currentRange = null;
      }
    }

    if (currentRange !== null) {
      unloaded.push(currentRange);
    }

    return unloaded;
  };

  // ==========================================================================
  // Chunk Operations
  // ==========================================================================

  const isChunkLoaded = (chunkIndex: number): boolean => {
    return chunks.has(chunkIndex);
  };

  const touchChunk = (chunkIndex: number): void => {
    const chunk = chunks.get(chunkIndex);
    if (chunk) {
      chunk.lastAccess = Date.now();
    }
  };

  // ==========================================================================
  // Eviction
  // ==========================================================================

  /**
   * Evict chunks far from visible range
   */
  const evictDistant = (visibleStart: number, visibleEnd: number): number => {
    // Only evict if we exceed the limit
    if (cachedItemCount <= maxCachedItems) {
      return 0;
    }

    // Calculate keep zone with buffer
    const keepStart = Math.max(0, visibleStart - evictionBuffer);
    const keepEnd = Math.min(totalItems - 1, visibleEnd + evictionBuffer);

    const keepChunkStart = getChunkIndex(keepStart);
    const keepChunkEnd = getChunkIndex(keepEnd);

    let evictedCount = 0;
    const evictedRanges: number[] = [];

    // Find chunks to evict
    for (const [chunkIndex, chunk] of chunks) {
      if (chunkIndex < keepChunkStart || chunkIndex > keepChunkEnd) {
        evictedCount += chunk.count;
        evictedRanges.push(chunkIndex);
        cachedItemCount -= chunk.count;
        chunks.delete(chunkIndex);
      }
    }

    // Notify about eviction
    if (evictedCount > 0 && onEvict) {
      onEvict(evictedCount, evictedRanges);
    }

    return evictedCount;
  };

  /**
   * Force eviction using LRU to meet memory limit
   */
  const evictToLimit = (): number => {
    if (cachedItemCount <= maxCachedItems) {
      return 0;
    }

    // Sort chunks by last access (oldest first)
    const sortedChunks = Array.from(chunks.entries()).sort(
      ([, a], [, b]) => a.lastAccess - b.lastAccess,
    );

    let evictedCount = 0;
    const evictedRanges: number[] = [];

    // Evict oldest chunks until under limit
    for (const [chunkIndex, chunk] of sortedChunks) {
      if (cachedItemCount <= maxCachedItems) {
        break;
      }

      evictedCount += chunk.count;
      cachedItemCount -= chunk.count;
      evictedRanges.push(chunkIndex);
      chunks.delete(chunkIndex);
    }

    // Notify about eviction
    if (evictedCount > 0 && onEvict) {
      onEvict(evictedCount, evictedRanges);
    }

    return evictedCount;
  };

  // ==========================================================================
  // Statistics
  // ==========================================================================

  const getStats = (): SparseStorageStats => {
    return {
      totalItems,
      cachedItems: cachedItemCount,
      cachedChunks: chunks.size,
      chunkSize,
      maxCachedItems,
      memoryEfficiency: totalItems > 0 ? 1 - cachedItemCount / totalItems : 1,
    };
  };

  const getCachedCount = (): number => cachedItemCount;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  const clear = (): void => {
    chunks.clear();
    cachedItemCount = 0;
  };

  const reset = (): void => {
    clear();
    totalItems = 0;
  };

  // ==========================================================================
  // Return Public API
  // ==========================================================================

  return {
    chunkSize,
    maxCachedItems,

    getTotal,
    setTotal,

    get,
    has,
    set,
    setRange,
    delete: deleteItem,

    getRange,
    isRangeLoaded,
    getLoadedRanges,
    findUnloadedRanges,

    getChunkIndex,
    isChunkLoaded,
    touchChunk,

    evictDistant,
    evictToLimit,

    getStats,
    getCachedCount,

    clear,
    reset,
  };
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Merge adjacent/overlapping ranges
 */
export const mergeRanges = (ranges: Range[]): Range[] => {
  if (ranges.length === 0) return [];

  // Sort by start
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Range[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;

    if (current.start <= last.end + 1) {
      // Overlapping or adjacent - merge
      last.end = Math.max(last.end, current.end);
    } else {
      // Gap - new range
      merged.push({ ...current });
    }
  }

  return merged;
};

/**
 * Calculate ranges that need to be loaded
 */
export const calculateMissingRanges = (
  needed: Range,
  loaded: Range[],
  chunkSize: number,
): Range[] => {
  // Align to chunk boundaries for efficient loading
  const alignedStart = Math.floor(needed.start / chunkSize) * chunkSize;
  const alignedEnd = Math.ceil((needed.end + 1) / chunkSize) * chunkSize - 1;

  const alignedNeeded = { start: alignedStart, end: alignedEnd };

  if (loaded.length === 0) {
    return [alignedNeeded];
  }

  const missing: Range[] = [];
  const merged = mergeRanges(loaded);
  let current = alignedNeeded.start;

  for (const range of merged) {
    if (range.start > current && range.start <= alignedNeeded.end) {
      // Gap before this loaded range
      missing.push({
        start: current,
        end: Math.min(range.start - 1, alignedNeeded.end),
      });
    }

    if (range.end >= current) {
      current = range.end + 1;
    }

    if (current > alignedNeeded.end) break;
  }

  // Check for gap after all loaded ranges
  if (current <= alignedNeeded.end) {
    missing.push({
      start: current,
      end: alignedNeeded.end,
    });
  }

  return missing;
};
