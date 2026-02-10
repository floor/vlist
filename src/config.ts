/**
 * vlist - Configuration
 * Validates user config and resolves defaults + derived flags.
 *
 * Follows the mtrl component config pattern:
 *   1. validateConfig() — throws on invalid input
 *   2. resolveConfig() — returns a fully-resolved config object
 *
 * This keeps vlist.ts focused on wiring, not on parsing configuration.
 */

import type {
  VListConfig,
  VListItem,
  ItemTemplate,
  SelectionMode,
  SelectionConfig,
  ScrollbarConfig,
  ScrollbarMode,
  ScrollConfig,
  LoadingConfig,
  ItemConfig,
  ScrollAxis,
} from "./types";

import type { GroupsConfig } from "./groups";
import type { GridConfig } from "./grid";

import {
  DEFAULT_OVERSCAN,
  DEFAULT_CLASS_PREFIX,
  CANCEL_LOAD_VELOCITY_THRESHOLD,
  PRELOAD_VELOCITY_THRESHOLD,
  PRELOAD_ITEMS_AHEAD,
} from "./constants";

// =============================================================================
// Types
// =============================================================================

/** Fully-resolved configuration with all defaults applied and derived flags */
export interface ResolvedConfig<T extends VListItem = VListItem> {
  // --- Direct config values (with defaults applied) ---

  readonly itemConfig: ItemConfig<T>;
  readonly initialItems: T[] | undefined;
  readonly adapter: VListConfig<T>["adapter"];
  readonly overscan: number;
  readonly selectionConfig: SelectionConfig | undefined;
  readonly loadingConfig: LoadingConfig | undefined;
  readonly classPrefix: string;
  readonly ariaLabel: string | undefined;
  readonly groupsConfig: GroupsConfig | undefined;
  readonly layoutMode: "list" | "grid";
  readonly gridConfig: GridConfig | undefined;
  readonly direction: ScrollAxis;

  // --- Scroll config (resolved from `scroll` domain) ---

  readonly scrollElement: Window | undefined;
  readonly scrollIdleTimeout: number | undefined;
  readonly wheelScroll: boolean;
  readonly scrollbarMode: ScrollbarMode;
  readonly scrollbarOptions: ScrollbarConfig | undefined;

  // --- Derived flags (computed once) ---

  readonly isWindowMode: boolean;
  readonly hasGroups: boolean;
  readonly isGrid: boolean;
  readonly isHorizontal: boolean;

  // --- Shortcuts into nested config ---

  readonly itemHeightConfig: number | ((index: number) => number);
  readonly userTemplate: ItemTemplate<T>;
  readonly selectionMode: SelectionMode;

  // --- Loading thresholds (with defaults) ---

  readonly cancelLoadThreshold: number;
  readonly preloadThreshold: number;
  readonly preloadAhead: number;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a VListConfig, throwing descriptive errors for invalid input.
 * Called once at creation time — not on the hot path.
 */
export const validateConfig = <T extends VListItem>(
  config: VListConfig<T>,
): void => {
  if (!config.container) {
    throw new Error("[vlist] Container is required");
  }
  if (!config.item) {
    throw new Error("[vlist] item configuration is required");
  }

  const isHorizontal = config.direction === "horizontal";

  // Validate scroll-axis dimension: height for vertical, width for horizontal
  if (isHorizontal) {
    if (config.item.width == null) {
      throw new Error(
        "[vlist] item.width is required when direction is 'horizontal'",
      );
    }
    if (typeof config.item.width === "number" && config.item.width <= 0) {
      throw new Error("[vlist] item.width must be a positive number");
    }
    if (
      typeof config.item.width !== "number" &&
      typeof config.item.width !== "function"
    ) {
      throw new Error(
        "[vlist] item.width must be a number or a function (index) => number",
      );
    }
  } else {
    if (config.item.height == null) {
      throw new Error("[vlist] item.height is required");
    }
    if (typeof config.item.height === "number" && config.item.height <= 0) {
      throw new Error("[vlist] item.height must be a positive number");
    }
    if (
      typeof config.item.height !== "number" &&
      typeof config.item.height !== "function"
    ) {
      throw new Error(
        "[vlist] item.height must be a number or a function (index) => number",
      );
    }
  }

  if (!config.item.template) {
    throw new Error("[vlist] item.template is required");
  }

  // Horizontal-specific restrictions
  if (isHorizontal) {
    if (config.layout === "grid") {
      throw new Error(
        "[vlist] horizontal direction cannot be combined with grid layout",
      );
    }
    if (config.groups) {
      throw new Error(
        "[vlist] horizontal direction cannot be combined with groups",
      );
    }
    if (config.scroll?.element) {
      throw new Error(
        "[vlist] horizontal direction cannot be combined with window scrolling",
      );
    }
  }

  // Grid-specific validation
  if (config.layout === "grid") {
    if (!config.grid) {
      throw new Error(
        "[vlist] grid configuration is required when layout is 'grid'",
      );
    }
    if (!config.grid.columns || config.grid.columns < 1) {
      throw new Error("[vlist] grid.columns must be a positive integer >= 1");
    }
    if (config.groups) {
      throw new Error("[vlist] grid layout cannot be combined with groups");
    }
  }
};

// =============================================================================
// Resolution
// =============================================================================

/**
 * Validate and resolve a VListConfig into a ResolvedConfig.
 *
 * Applies all defaults, computes derived flags, and extracts shortcuts
 * so that the factory function in vlist.ts can start wiring immediately
 * without any parsing / destructuring noise.
 */
/**
 * Resolve the scrollbar config shorthand into a mode + options pair.
 *
 * Accepts:
 * - `undefined` → custom scrollbar, default options
 * - `'native'` → browser's native scrollbar
 * - `'none'` → no scrollbar
 * - `{ autoHide?, ... }` → custom scrollbar with specific options
 */
const resolveScrollbar = (
  value: ScrollConfig["scrollbar"],
): {
  scrollbarMode: ScrollbarMode;
  scrollbarOptions: ScrollbarConfig | undefined;
} => {
  if (value == null) {
    return { scrollbarMode: "custom", scrollbarOptions: undefined };
  }
  if (typeof value === "string") {
    return { scrollbarMode: value, scrollbarOptions: undefined };
  }
  // Object form → custom scrollbar with options
  return { scrollbarMode: "custom", scrollbarOptions: value };
};

export const resolveConfig = <T extends VListItem>(
  config: VListConfig<T>,
): ResolvedConfig<T> => {
  // Validate first (throws on bad input)
  validateConfig(config);

  // Destructure with defaults
  const {
    item: itemConfig,
    items: initialItems,
    adapter,
    overscan = DEFAULT_OVERSCAN,
    selection: selectionConfig,
    scroll: scrollConfig,
    loading: loadingConfig,
    classPrefix = DEFAULT_CLASS_PREFIX,
    ariaLabel,
    groups: groupsConfig,
    layout: layoutMode = "list",
    grid: gridConfig,
    direction = "vertical",
  } = config;

  // Resolve scroll domain
  const scrollElement = scrollConfig?.element;
  const scrollIdleTimeout = scrollConfig?.idleTimeout;
  const wheelScroll = scrollConfig?.wheel ?? true;
  const { scrollbarMode, scrollbarOptions } = resolveScrollbar(
    scrollConfig?.scrollbar,
  );

  // Derived flags
  const isWindowMode = !!scrollElement;
  const hasGroups = !!groupsConfig;
  const isGrid = layoutMode === "grid" && !!gridConfig;
  const isHorizontal = direction === "horizontal";

  // Shortcuts into nested config
  // In horizontal mode, item.width is the scroll-axis dimension;
  // in vertical mode, item.height is. Internally everything uses "itemHeightConfig".
  const itemHeightConfig: number | ((index: number) => number) = isHorizontal
    ? itemConfig.width!
    : itemConfig.height!;
  const { template: userTemplate } = itemConfig;
  const selectionMode: SelectionMode = selectionConfig?.mode ?? "none";

  // Loading thresholds with defaults from constants
  const cancelLoadThreshold =
    loadingConfig?.cancelThreshold ?? CANCEL_LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loadingConfig?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loadingConfig?.preloadAhead ?? PRELOAD_ITEMS_AHEAD;

  return {
    itemConfig,
    initialItems,
    adapter,
    overscan,
    selectionConfig,
    loadingConfig,
    classPrefix,
    ariaLabel,
    groupsConfig,
    layoutMode,
    gridConfig,
    direction,

    scrollElement,
    scrollIdleTimeout,
    wheelScroll,
    scrollbarMode,
    scrollbarOptions,

    isWindowMode,
    hasGroups,
    isGrid,
    isHorizontal,

    itemHeightConfig,
    userTemplate,
    selectionMode,

    cancelLoadThreshold,
    preloadThreshold,
    preloadAhead,
  };
};
