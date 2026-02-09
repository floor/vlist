/**
 * vlist - Context
 * Internal state container that wires all domains together
 *
 * The context holds all stateful components and provides
 * a clean interface for handlers and methods to access them.
 */

import type {
  VListItem,
  VListEvents,
  Range,
  ViewportState,
  SelectionMode,
} from "./types";

import type { DataManager } from "./data";
import type { ScrollController, Scrollbar } from "./scroll";
import type { Emitter } from "./events";
import type {
  Renderer,
  DOMStructure,
  CompressionContext,
  CompressionState,
  HeightCache,
} from "./render";
import type { SelectionState } from "./selection";

import { getCompressionState } from "./render";

// =============================================================================
// Types
// =============================================================================

/** Immutable configuration extracted from VListConfig */
export interface VListContextConfig {
  readonly itemHeight: number | ((index: number) => number);
  readonly overscan: number;
  readonly classPrefix: string;
  readonly selectionMode: SelectionMode;
  readonly hasAdapter: boolean;
  /** Velocity threshold above which loading is skipped (px/ms) */
  readonly cancelLoadThreshold: number;
  /** Velocity threshold for preloading (px/ms) */
  readonly preloadThreshold: number;
  /** Number of items to preload ahead of scroll direction */
  readonly preloadAhead: number;
}

/** Cached compression state */
export interface CachedCompression {
  state: CompressionState;
  totalItems: number;
}

/** Mutable state managed by the context */
export interface VListContextState {
  viewportState: ViewportState;
  selectionState: SelectionState;
  lastRenderRange: Range;
  isInitialized: boolean;
  isDestroyed: boolean;
  /** Cached compression state (invalidated when totalItems changes) */
  cachedCompression: CachedCompression | null;
}

/**
 * VListContext - Central state container
 *
 * Provides access to all internal components and state.
 * Passed to handlers and methods for a clean dependency injection pattern.
 */
export interface VListContext<T extends VListItem = VListItem> {
  // Immutable configuration
  readonly config: VListContextConfig;

  // DOM structure
  readonly dom: DOMStructure;

  // Height cache for efficient offset/index lookups
  readonly heightCache: HeightCache;

  // Stateful managers
  readonly dataManager: DataManager<T>;
  readonly scrollController: ScrollController;
  readonly renderer: Renderer<T>;
  readonly emitter: Emitter<VListEvents<T>>;
  readonly scrollbar: Scrollbar | null;

  // Mutable state
  state: VListContextState;

  // Helper methods
  getItemsForRange: (range: Range) => T[];
  getAllLoadedItems: () => T[];
  getCompressionContext: () => CompressionContext;
  /** Get cached compression state (recalculates only when totalItems changes) */
  getCachedCompression: () => CompressionState;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a VListContext from individual components
 *
 * This is called from vlist.ts after all components are created.
 * The context acts as a facade to access everything in one place.
 */
export const createContext = <T extends VListItem = VListItem>(
  config: VListContextConfig,
  dom: DOMStructure,
  heightCache: HeightCache,
  dataManager: DataManager<T>,
  scrollController: ScrollController,
  renderer: Renderer<T>,
  emitter: Emitter<VListEvents<T>>,
  scrollbar: Scrollbar | null,
  initialState: VListContextState,
): VListContext<T> => {
  // State is mutable and will be updated by handlers
  const state = initialState;

  // Reusable compression context object (avoids allocation on every frame)
  const reusableCompressionCtx: CompressionContext = {
    scrollTop: 0,
    totalItems: 0,
    containerHeight: 0,
    rangeStart: 0,
  };

  /**
   * Get items for a render range
   */
  const getItemsForRange = (range: Range): T[] => {
    return dataManager.getItemsInRange(range.start, range.end);
  };

  /**
   * Get all loaded items (for selection operations)
   */
  const getAllLoadedItems = (): T[] => {
    const total = dataManager.getTotal();
    return dataManager.getItemsInRange(0, total - 1);
  };

  /**
   * Get cached compression state
   * Only recalculates when totalItems changes
   */
  const getCachedCompression = (): CompressionState => {
    const totalItems = dataManager.getTotal();

    // Return cached if still valid
    if (
      state.cachedCompression &&
      state.cachedCompression.totalItems === totalItems
    ) {
      return state.cachedCompression.state;
    }

    // Recalculate and cache
    const compression = getCompressionState(totalItems, heightCache);
    state.cachedCompression = { state: compression, totalItems };
    return compression;
  };

  /**
   * Get compression context for rendering
   * Reuses a single object to avoid allocation on every scroll frame
   */
  const getCompressionContext = (): CompressionContext => {
    reusableCompressionCtx.scrollTop = state.viewportState.scrollTop;
    reusableCompressionCtx.totalItems = dataManager.getTotal();
    reusableCompressionCtx.containerHeight =
      state.viewportState.containerHeight;
    reusableCompressionCtx.rangeStart = state.viewportState.renderRange.start;
    return reusableCompressionCtx;
  };

  return {
    config,
    dom,
    heightCache,
    dataManager,
    scrollController,
    renderer,
    emitter,
    scrollbar,
    state,
    getItemsForRange,
    getAllLoadedItems,
    getCompressionContext,
    getCachedCompression,
  };
};
