/**
 * vlist - Context
 * Internal state container that wires all domains together
 *
 * The context holds all stateful components and provides
 * a clean interface for handlers and methods to access them.
 */

import type {
  VListItem,
  VListConfig,
  VListEvents,
  Range,
  ViewportState,
  SelectionMode,
} from "./types";

import type { DataManager } from "./data";
import type { ScrollController, Scrollbar } from "./scroll";
import type { Emitter } from "./events";
import type { Renderer, DOMStructure, CompressionContext } from "./render";
import type { SelectionState } from "./selection";

// =============================================================================
// Types
// =============================================================================

/** Immutable configuration extracted from VListConfig */
export interface VListContextConfig {
  readonly itemHeight: number;
  readonly overscan: number;
  readonly classPrefix: string;
  readonly selectionMode: SelectionMode;
  readonly hasAdapter: boolean;
}

/** Mutable state managed by the context */
export interface VListContextState {
  viewportState: ViewportState;
  selectionState: SelectionState;
  lastRenderRange: Range;
  isInitialized: boolean;
  isDestroyed: boolean;
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
  dataManager: DataManager<T>,
  scrollController: ScrollController,
  renderer: Renderer<T>,
  emitter: Emitter<VListEvents<T>>,
  scrollbar: Scrollbar | null,
  initialState: VListContextState,
): VListContext<T> => {
  // State is mutable and will be updated by handlers
  const state = initialState;

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
    const total = dataManager.getState().total;
    return dataManager.getItemsInRange(0, total - 1);
  };

  /**
   * Get compression context for rendering
   */
  const getCompressionContext = (): CompressionContext => ({
    scrollTop: state.viewportState.scrollTop,
    totalItems: dataManager.getState().total,
    containerHeight: state.viewportState.containerHeight,
    rangeStart: state.viewportState.renderRange.start,
  });

  return {
    config,
    dom,
    dataManager,
    scrollController,
    renderer,
    emitter,
    scrollbar,
    state,
    getItemsForRange,
    getAllLoadedItems,
    getCompressionContext,
  };
};
