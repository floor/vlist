/**
 * vlist/builder - Lightweight In-Memory Data Manager
 *
 * A minimal data manager that stores items in a plain array.
 * No sparse storage, no placeholders, no async adapter support.
 *
 * This keeps the builder core small (~12 KB). When the user installs
 * withData(), that plugin replaces this manager with the full
 * adapter-backed data manager from src/data/manager.ts.
 */

import type { VListItem, Range } from "../types";

// =============================================================================
// Types (minimal subset of DataManager interface from data/manager.ts)
// =============================================================================

/** Minimal data state */
export interface SimpleDataState<_T extends VListItem = VListItem> {
  total: number;
  cached: number;
  isLoading: boolean;
  pendingRanges: Range[];
  error: Error | undefined;
  hasMore: boolean;
  cursor: string | undefined;
}

/**
 * SimpleDataManager — the same interface as the full DataManager,
 * but backed by a plain array instead of sparse storage + placeholders.
 *
 * Only the methods used by the builder core and plugins are implemented.
 * Adapter-related methods (loadRange, ensureRange, loadInitial, loadMore,
 * reload, evictDistant) are no-ops or stubs.
 */
export interface SimpleDataManager<T extends VListItem = VListItem> {
  getState: () => SimpleDataState<T>;
  getTotal: () => number;
  getCached: () => number;
  getIsLoading: () => boolean;
  getHasMore: () => boolean;
  getStorage: () => unknown;
  getPlaceholders: () => unknown;
  getItem: (index: number) => T | undefined;
  isItemLoaded: (index: number) => boolean;
  getItemsInRange: (start: number, end: number) => T[];
  setTotal: (total: number) => void;
  setItems: (items: T[], offset?: number, total?: number) => void;
  updateItem: (index: number, updates: Partial<T>) => boolean;
  removeItem: (index: number) => boolean;
  loadRange: (start: number, end: number) => Promise<void>;
  ensureRange: (start: number, end: number) => Promise<void>;
  loadInitial: () => Promise<void>;
  loadMore: (direction?: "down" | "up") => Promise<boolean>;
  reload: () => Promise<void>;
  evictDistant: (visibleStart: number, visibleEnd: number) => void;
  clear: () => void;
  reset: () => void;
}

// =============================================================================
// Config
// =============================================================================

export interface SimpleDataManagerConfig<T extends VListItem = VListItem> {
  initialItems?: T[];
  initialTotal?: number;
  onStateChange?: (state: SimpleDataState<T>) => void;
  onItemsLoaded?: (items: T[], offset: number, total: number) => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a lightweight in-memory data manager.
 *
 * Items are stored in a plain array. ID lookups use a Map.
 * No sparse storage, no placeholders, no chunking, no eviction.
 *
 * ~1 KB minified vs ~8 KB for the full data manager.
 */
export const createSimpleDataManager = <T extends VListItem = VListItem>(
  config: SimpleDataManagerConfig<T> = {},
): SimpleDataManager<T> => {
  const { onStateChange, onItemsLoaded } = config;
  const notifyItemsLoaded = (
    loadedItems: T[],
    offset: number,
    newTotal: number,
  ): void => {
    if (onItemsLoaded) onItemsLoaded(loadedItems, offset, newTotal);
  };

  let items: T[] = config.initialItems || [];
  let total = config.initialTotal ?? items.length;

  // ID → index map removed for memory efficiency
  // Users can maintain their own Map if needed for O(1) lookups

  const notifyStateChange = (): void => {
    if (onStateChange) onStateChange(getState());
  };

  // ── State ───────────────────────────────────────────────────────

  const getState = (): SimpleDataState<T> => ({
    total,
    cached: items.length,
    isLoading: false,
    pendingRanges: [],
    error: undefined,
    hasMore: false,
    cursor: undefined,
  });

  const getTotal = (): number => total;
  const getCached = (): number => items.length;
  const getIsLoading = (): boolean => false;
  const getHasMore = (): boolean => false;

  // ── Item access ─────────────────────────────────────────────────

  const getItem = (index: number): T | undefined => items[index];

  // getItemById and getIndexById removed for memory efficiency
  // Users can maintain their own id→index Map if needed

  const isItemLoaded = (index: number): boolean => {
    return index >= 0 && index < items.length && items[index] !== undefined;
  };

  const getItemsInRange = (start: number, end: number): T[] => {
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(end, total - 1);
    const result: T[] = [];
    for (let i = safeStart; i <= safeEnd; i++) {
      result.push(items[i] as T);
    }
    return result;
  };

  // ── Data operations ─────────────────────────────────────────────

  const setTotal = (newTotal: number): void => {
    total = newTotal;
  };

  const setItems = (newItems: T[], offset = 0, newTotal?: number): void => {
    if (offset === 0 && (newTotal !== undefined || items.length === 0)) {
      // Full replacement - use reference (no copy)
      items = newItems;
      total = newTotal ?? newItems.length;
    } else {
      // Partial set (append at offset)
      for (let i = 0; i < newItems.length; i++) {
        items[offset + i] = newItems[i]!;
      }
      total = Math.max(total, offset + newItems.length);
      if (newTotal !== undefined) total = newTotal;
    }
    notifyStateChange();
    notifyItemsLoaded(newItems, offset, total);
  };

  const updateItem = (index: number, updates: Partial<T>): boolean => {
    if (index < 0 || index >= items.length) return false;

    const item = items[index];
    if (!item) return false;

    items[index] = { ...item, ...updates } as T;

    notifyStateChange();
    return true;
  };

  const removeItem = (index: number): boolean => {
    if (index < 0 || index >= items.length) return false;

    items.splice(index, 1);
    total = Math.max(0, total - 1);
    notifyStateChange();
    return true;
  };

  // ── Stubs (no-ops for adapter-related methods) ──────────────────

  const noop = async (): Promise<void> => {};
  const noopBool = async (): Promise<boolean> => false;

  const clear = (): void => {
    items = [];
    total = 0;
  };

  const reset = (): void => {
    clear();
    notifyStateChange();
  };

  // ── Return ──────────────────────────────────────────────────────

  return {
    getState,
    getTotal,
    getCached,
    getIsLoading,
    getHasMore,
    getStorage: () => null,
    getPlaceholders: () => null,
    getItem,
    isItemLoaded,
    getItemsInRange,
    setTotal,
    setItems,
    updateItem,
    removeItem,
    loadRange: noop,
    ensureRange: noop,
    loadInitial: noop,
    loadMore: noopBool,
    reload: noop,
    evictDistant: () => {},
    clear,
    reset,
  };
};
