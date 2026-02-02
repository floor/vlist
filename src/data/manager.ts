/**
 * vlist - Data Management
 * Handles data with sparse storage for million+ item support
 */

// Debug flag - set to true to enable logging
const DEBUG = false;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log("[data-manager]", ...args);
};

import type { VListItem, VListAdapter, AdapterParams, Range } from "../types";

import {
  createSparseStorage,
  calculateMissingRanges,
  type SparseStorage,
  type SparseStorageConfig,
} from "./sparse";

import {
  createPlaceholderManager,
  isPlaceholderItem,
  type PlaceholderConfig,
  type PlaceholderManager,
} from "./placeholder";

// =============================================================================
// Types
// =============================================================================

/** Data manager configuration */
export interface DataManagerConfig<T extends VListItem = VListItem> {
  /** Async data adapter */
  adapter?: VListAdapter<T>;

  /** Initial items (optional) */
  initialItems?: T[];

  /** Initial total count (if known) */
  initialTotal?: number;

  /** Sparse storage configuration */
  storage?: SparseStorageConfig;

  /** Placeholder configuration */
  placeholder?: PlaceholderConfig;

  /** Items per load request (default: 50) */
  pageSize?: number;

  /** Callback when state changes */
  onStateChange?: (state: DataState<T>) => void;

  /** Callback when items are loaded */
  onItemsLoaded?: (items: T[], offset: number, total: number) => void;

  /** Callback when items are evicted */
  onItemsEvicted?: (count: number) => void;
}

/** Data state */
export interface DataState<_T extends VListItem = VListItem> {
  /** Total items (declared, may be larger than loaded) */
  total: number;

  /** Number of items in memory */
  cached: number;

  /** Whether data is loading */
  isLoading: boolean;

  /** Pending load ranges */
  pendingRanges: Range[];

  /** Error from last operation */
  error: Error | undefined;

  /** Whether more items exist */
  hasMore: boolean;

  /** Current cursor (for cursor pagination) */
  cursor: string | undefined;
}

/** Data manager instance */
export interface DataManager<T extends VListItem = VListItem> {
  // State
  /** Get current state */
  getState: () => DataState<T>;

  /** Get sparse storage */
  getStorage: () => SparseStorage<T>;

  /** Get placeholder manager */
  getPlaceholders: () => PlaceholderManager<T>;

  // Item access
  /** Get item at index (may return placeholder if not loaded) */
  getItem: (index: number) => T | undefined;

  /** Get item by ID */
  getItemById: (id: string | number) => T | undefined;

  /** Get index by ID (-1 if not found) */
  getIndexById: (id: string | number) => number;

  /** Check if item at index is loaded (not placeholder) */
  isItemLoaded: (index: number) => boolean;

  /** Get items in range (includes placeholders for unloaded) */
  getItemsInRange: (start: number, end: number) => T[];

  // Data operations
  /** Set total item count */
  setTotal: (total: number) => void;

  /** Set items at offset */
  setItems: (items: T[], offset?: number, total?: number) => void;

  /** Update item by ID */
  updateItem: (id: string | number, updates: Partial<T>) => boolean;

  /** Remove item by ID */
  removeItem: (id: string | number) => boolean;

  // Loading
  /** Load items for a range */
  loadRange: (start: number, end: number) => Promise<void>;

  /** Ensure range is loaded (no-op if already loaded) */
  ensureRange: (start: number, end: number) => Promise<void>;

  /** Load initial data */
  loadInitial: () => Promise<void>;

  /** Load more items (infinite scroll) */
  loadMore: () => Promise<boolean>;

  /** Reload all data */
  reload: () => Promise<void>;

  // Memory management
  /** Evict items far from visible range */
  evictDistant: (visibleStart: number, visibleEnd: number) => void;

  // Lifecycle
  /** Clear all data */
  clear: () => void;

  /** Reset to initial state */
  reset: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PAGE_SIZE = 50;

// =============================================================================
// Data Manager Implementation
// =============================================================================

/**
 * Create a data manager with sparse storage support
 */
export const createDataManager = <T extends VListItem = VListItem>(
  config: DataManagerConfig<T> = {},
): DataManager<T> => {
  const {
    adapter,
    initialItems,
    initialTotal,
    storage: storageConfig,
    placeholder: placeholderConfig,
    pageSize = DEFAULT_PAGE_SIZE,
    onStateChange,
    onItemsLoaded,
    onItemsEvicted,
  } = config;

  // Create sparse storage
  const storage = createSparseStorage<T>({
    ...storageConfig,
    onEvict: (count, _ranges) => {
      onItemsEvicted?.(count);
      notifyStateChange();
    },
  });

  // Create placeholder manager
  const placeholders = createPlaceholderManager<T>(placeholderConfig);

  // ID to index mapping (only for loaded items)
  const idToIndex = new Map<string | number, number>();

  // State
  let isLoading = false;
  let error: Error | undefined;
  let hasMore = true;
  let cursor: string | undefined;
  let pendingRanges: Range[] = [];

  // Track active load requests to prevent duplicates
  const activeLoads = new Map<string, Promise<void>>();

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Notify state change
   */
  const notifyStateChange = (): void => {
    onStateChange?.(getState());
  };

  /**
   * Rebuild ID index for loaded items
   */
  const rebuildIdIndex = (): void => {
    idToIndex.clear();

    const loadedRanges = storage.getLoadedRanges();
    for (const range of loadedRanges) {
      for (let i = range.start; i <= range.end; i++) {
        const item = storage.get(i);
        if (item && !isPlaceholderItem(item)) {
          idToIndex.set(item.id, i);
        }
      }
    }
  };

  /**
   * Update ID index for a specific item
   */
  const updateIdIndex = (index: number, item: T): void => {
    if (!isPlaceholderItem(item)) {
      idToIndex.set(item.id, index);
    }
  };

  /**
   * Remove from ID index
   */
  const removeFromIdIndex = (id: string | number): void => {
    idToIndex.delete(id);
  };

  /**
   * Get range key for deduplication
   */
  const getRangeKey = (start: number, end: number): string => {
    return `${start}-${end}`;
  };

  // ==========================================================================
  // State
  // ==========================================================================

  const getState = (): DataState<T> => ({
    total: storage.getTotal(),
    cached: storage.getCachedCount(),
    isLoading,
    pendingRanges: [...pendingRanges],
    error,
    hasMore,
    cursor,
  });

  const getStorage = (): SparseStorage<T> => storage;

  const getPlaceholders = (): PlaceholderManager<T> => placeholders;

  // ==========================================================================
  // Item Access
  // ==========================================================================

  const getItem = (index: number): T | undefined => {
    const item = storage.get(index);

    // Return loaded item
    if (item !== undefined) {
      return item;
    }

    // Return placeholder for unloaded within total
    if (index >= 0 && index < storage.getTotal()) {
      return placeholders.generate(index);
    }

    return undefined;
  };

  const getItemById = (id: string | number): T | undefined => {
    const index = idToIndex.get(id);
    if (index === undefined) {
      return undefined;
    }
    return storage.get(index);
  };

  const getIndexById = (id: string | number): number => {
    return idToIndex.get(id) ?? -1;
  };

  const isItemLoaded = (index: number): boolean => {
    const item = storage.get(index);
    return item !== undefined && !isPlaceholderItem(item);
  };

  const getItemsInRange = (start: number, end: number): T[] => {
    const items: T[] = [];
    const total = storage.getTotal();
    let loadedCount = 0;
    let placeholderCount = 0;

    for (let i = start; i <= end && i < total; i++) {
      const item = storage.get(i);
      if (item !== undefined) {
        items.push(item);
        loadedCount++;
      } else {
        // Generate placeholder for unloaded
        items.push(placeholders.generate(i));
        placeholderCount++;
      }
    }

    return items;
  };

  // ==========================================================================
  // Data Operations
  // ==========================================================================

  const setTotal = (total: number): void => {
    storage.setTotal(total);
    hasMore = storage.getCachedCount() < total;
    notifyStateChange();
  };

  const setItems = (items: T[], offset: number = 0, total?: number): void => {
    log(`setItems: offset=${offset}, count=${items.length}, total=${total}`);

    // Analyze structure for placeholders from first batch
    if (!placeholders.hasAnalyzedStructure() && items.length > 0) {
      placeholders.analyzeStructure(items);
    }

    // Store items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item !== undefined) {
        const index = offset + i;
        storage.set(index, item);
        updateIdIndex(index, item);
      }
    }

    // Update total
    if (total !== undefined) {
      storage.setTotal(total);
    } else if (offset + items.length > storage.getTotal()) {
      storage.setTotal(offset + items.length);
    }

    hasMore = storage.getCachedCount() < storage.getTotal();

    // Notify
    onItemsLoaded?.(items, offset, storage.getTotal());
    notifyStateChange();
  };

  const updateItem = (id: string | number, updates: Partial<T>): boolean => {
    const index = idToIndex.get(id);
    if (index === undefined) {
      return false;
    }

    const existing = storage.get(index);
    if (!existing) {
      return false;
    }

    const updated = { ...existing, ...updates } as T;
    storage.set(index, updated);

    // Update ID index if ID changed
    if (updates.id !== undefined && updates.id !== id) {
      removeFromIdIndex(id);
      updateIdIndex(index, updated);
    }

    notifyStateChange();
    return true;
  };

  const removeItem = (id: string | number): boolean => {
    const index = idToIndex.get(id);
    if (index === undefined) {
      return false;
    }

    storage.delete(index);
    removeFromIdIndex(id);

    // Decrease total
    const currentTotal = storage.getTotal();
    if (currentTotal > 0) {
      storage.setTotal(currentTotal - 1);
    }

    // Rebuild index since indices shifted conceptually
    // Note: In a true sparse array, items don't shift, but the total decreases
    notifyStateChange();
    return true;
  };

  // ==========================================================================
  // Loading
  // ==========================================================================

  const loadRange = async (start: number, end: number): Promise<void> => {
    if (!adapter) {
      return;
    }

    const rangeKey = getRangeKey(start, end);

    // If already loading this exact range, wait for it
    // Skip if already loading this range
    if (activeLoads.has(rangeKey)) {
      return;
    }

    // Find what's actually missing
    const loadedRanges = storage.getLoadedRanges();
    const missingRanges = calculateMissingRanges(
      { start, end },
      loadedRanges,
      storage.chunkSize,
    );

    if (missingRanges.length === 0) {
      return;
    }

    // Split missing ranges into individual chunks to properly deduplicate
    const chunkSize = storage.chunkSize;
    const chunksToLoad: Array<{ start: number; end: number }> = [];

    for (const range of missingRanges) {
      // Split this range into individual chunks
      const firstChunk = Math.floor(range.start / chunkSize);
      const lastChunk = Math.floor(range.end / chunkSize);

      for (let chunkIdx = firstChunk; chunkIdx <= lastChunk; chunkIdx++) {
        const chunkStart = chunkIdx * chunkSize;
        const chunkEnd = chunkStart + chunkSize - 1;
        const key = getRangeKey(chunkStart, chunkEnd);

        // Only add if not already in our list and not already loading
        if (
          !chunksToLoad.some((c) => c.start === chunkStart) &&
          !activeLoads.has(key)
        ) {
          chunksToLoad.push({ start: chunkStart, end: chunkEnd });
        }
      }
    }

    // Load each chunk
    const loadPromises: Promise<void>[] = [];

    // First, collect promises for chunks already being loaded
    for (const range of missingRanges) {
      const firstChunk = Math.floor(range.start / chunkSize);
      const lastChunk = Math.floor(range.end / chunkSize);

      for (let chunkIdx = firstChunk; chunkIdx <= lastChunk; chunkIdx++) {
        const chunkStart = chunkIdx * chunkSize;
        const chunkEnd = chunkStart + chunkSize - 1;
        const key = getRangeKey(chunkStart, chunkEnd);

        if (activeLoads.has(key)) {
          const existingPromise = activeLoads.get(key)!;
          if (!loadPromises.includes(existingPromise)) {
            loadPromises.push(existingPromise);
          }
        }
      }
    }

    // Now load chunks that aren't already loading
    for (const chunk of chunksToLoad) {
      const key = getRangeKey(chunk.start, chunk.end);

      // Double-check it's not loading (could have been added by concurrent call)
      if (activeLoads.has(key)) {
        const existingPromise = activeLoads.get(key)!;
        if (!loadPromises.includes(existingPromise)) {
          loadPromises.push(existingPromise);
        }
        continue;
      }

      // Create the load promise for this chunk
      const loadPromise = (async () => {
        pendingRanges.push(chunk);
        isLoading = true;
        error = undefined;
        notifyStateChange();

        try {
          const limit = chunk.end - chunk.start + 1;
          const params: AdapterParams = {
            offset: chunk.start,
            limit,
            cursor: undefined,
          };

          const response = await adapter.read(params);

          // Store items
          setItems(response.items, chunk.start, response.total);
          log(
            `loadRange: stored items, cached=${storage.getCachedCount()}, total=${storage.getTotal()}`,
          );

          // Update cursor and hasMore
          if (response.cursor) {
            cursor = response.cursor;
          }
          if (response.hasMore !== undefined) {
            hasMore = response.hasMore;
          } else if (response.total !== undefined) {
            hasMore = storage.getCachedCount() < response.total;
          }
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
        } finally {
          activeLoads.delete(key);
          pendingRanges = pendingRanges.filter(
            (r) => r.start !== chunk.start || r.end !== chunk.end,
          );
          isLoading = activeLoads.size > 0;
          notifyStateChange();
        }
      })();

      activeLoads.set(key, loadPromise);
      loadPromises.push(loadPromise);
    }

    // Wait for all loads to complete
    await Promise.all(loadPromises);
  };

  const ensureRange = async (start: number, end: number): Promise<void> => {
    // Check if range is already fully loaded
    if (storage.isRangeLoaded(start, end)) {
      return;
    }

    await loadRange(start, end);
  };

  const loadInitial = async (): Promise<void> => {
    if (!adapter) {
      return;
    }

    await loadRange(0, pageSize - 1);
  };

  const loadMore = async (): Promise<boolean> => {
    if (!adapter || isLoading || !hasMore) {
      return false;
    }

    const currentCached = storage.getCachedCount();
    const total = storage.getTotal();

    // Calculate next range to load
    const start = currentCached;
    const end = Math.min(
      start + pageSize - 1,
      total > 0 ? total - 1 : start + pageSize - 1,
    );

    if (start >= total && total > 0) {
      hasMore = false;
      return false;
    }

    await loadRange(start, end);

    return storage.getCachedCount() > currentCached;
  };

  const reload = async (): Promise<void> => {
    // Clear everything
    storage.clear();
    idToIndex.clear();
    placeholders.clear();
    cursor = undefined;
    hasMore = true;
    error = undefined;

    notifyStateChange();

    // Load initial data
    await loadInitial();
  };

  // ==========================================================================
  // Memory Management
  // ==========================================================================

  const evictDistant = (visibleStart: number, visibleEnd: number): void => {
    const evicted = storage.evictDistant(visibleStart, visibleEnd);

    if (evicted > 0) {
      // Rebuild ID index after eviction
      rebuildIdIndex();
    }
  };

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  const clear = (): void => {
    storage.clear();
    idToIndex.clear();
    cursor = undefined;
    error = undefined;
    pendingRanges = [];
    isLoading = false;
    notifyStateChange();
  };

  const reset = (): void => {
    storage.reset();
    idToIndex.clear();
    placeholders.clear();
    cursor = undefined;
    hasMore = true;
    error = undefined;
    pendingRanges = [];
    isLoading = false;
    notifyStateChange();
  };

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Initialize with provided items
  if (initialItems && initialItems.length > 0) {
    setItems(initialItems, 0, initialTotal ?? initialItems.length);
  } else if (initialTotal !== undefined) {
    storage.setTotal(initialTotal);
  }

  // ==========================================================================
  // Return Public API
  // ==========================================================================

  return {
    getState,
    getStorage,
    getPlaceholders,

    getItem,
    getItemById,
    getIndexById,
    isItemLoaded,
    getItemsInRange,

    setTotal,
    setItems,
    updateItem,
    removeItem,

    loadRange,
    ensureRange,
    loadInitial,
    loadMore,
    reload,

    evictDistant,

    clear,
    reset,
  };
};

// =============================================================================
// Utility Functions (Re-export from sparse for convenience)
// =============================================================================

export { mergeRanges, calculateMissingRanges } from "./sparse";
export {
  isPlaceholderItem,
  filterPlaceholders,
  countRealItems,
} from "./placeholder";
