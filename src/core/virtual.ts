/**
 * vlist - Virtual Scrolling Core
 * Pure functions for virtual scroll calculations
 */

import type { Range, ViewportState } from "../types";

// =============================================================================
// Range Calculations
// =============================================================================

/**
 * Calculate the visible range of items based on scroll position
 * Pure function - no side effects
 */
export const calculateVisibleRange = (
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
): Range => {
  if (totalItems === 0 || itemHeight === 0) {
    return { start: 0, end: 0 };
  }

  const start = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const end = Math.min(start + visibleCount, totalItems - 1);

  return {
    start: Math.max(0, start),
    end: Math.max(0, end),
  };
};

/**
 * Calculate the render range (visible + overscan buffer)
 * Pure function - no side effects
 */
export const calculateRenderRange = (
  visibleRange: Range,
  overscan: number,
  totalItems: number,
): Range => {
  if (totalItems === 0) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.max(0, visibleRange.start - overscan),
    end: Math.min(totalItems - 1, visibleRange.end + overscan),
  };
};

/**
 * Calculate total content height
 * Pure function - no side effects
 */
export const calculateTotalHeight = (
  totalItems: number,
  itemHeight: number,
): number => {
  return totalItems * itemHeight;
};

/**
 * Calculate the offset (translateY) for an item
 * Pure function - no side effects
 */
export const calculateItemOffset = (
  index: number,
  itemHeight: number,
): number => {
  return index * itemHeight;
};

// =============================================================================
// Scroll Position Calculations
// =============================================================================

/**
 * Calculate scroll position to bring an index into view
 * Pure function - no side effects
 */
export const calculateScrollToIndex = (
  index: number,
  itemHeight: number,
  containerHeight: number,
  align: "start" | "center" | "end" = "start",
): number => {
  const itemTop = index * itemHeight;
  const itemBottom = itemTop + itemHeight;

  switch (align) {
    case "start":
      return itemTop;

    case "center":
      return itemTop - (containerHeight - itemHeight) / 2;

    case "end":
      return itemBottom - containerHeight;

    default:
      return itemTop;
  }
};

/**
 * Clamp scroll position to valid range
 * Pure function - no side effects
 */
export const clampScrollPosition = (
  scrollTop: number,
  totalHeight: number,
  containerHeight: number,
): number => {
  const maxScroll = Math.max(0, totalHeight - containerHeight);
  return Math.max(0, Math.min(scrollTop, maxScroll));
};

/**
 * Determine scroll direction
 * Pure function - no side effects
 */
export const getScrollDirection = (
  currentScrollTop: number,
  previousScrollTop: number,
): "up" | "down" => {
  return currentScrollTop >= previousScrollTop ? "down" : "up";
};

// =============================================================================
// Viewport State
// =============================================================================

/**
 * Create initial viewport state
 * Pure function - no side effects
 */
export const createViewportState = (
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
): ViewportState => {
  const totalHeight = calculateTotalHeight(totalItems, itemHeight);
  const visibleRange = calculateVisibleRange(
    0,
    containerHeight,
    itemHeight,
    totalItems,
  );
  const renderRange = calculateRenderRange(visibleRange, overscan, totalItems);

  return {
    scrollTop: 0,
    containerHeight,
    totalHeight,
    visibleRange,
    renderRange,
  };
};

/**
 * Update viewport state after scroll
 * Pure function - returns new state
 */
export const updateViewportState = (
  state: ViewportState,
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
): ViewportState => {
  const visibleRange = calculateVisibleRange(
    scrollTop,
    state.containerHeight,
    itemHeight,
    totalItems,
  );
  const renderRange = calculateRenderRange(visibleRange, overscan, totalItems);

  return {
    ...state,
    scrollTop,
    visibleRange,
    renderRange,
  };
};

/**
 * Update viewport state when container resizes
 * Pure function - returns new state
 */
export const updateViewportSize = (
  state: ViewportState,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number,
): ViewportState => {
  const totalHeight = calculateTotalHeight(totalItems, itemHeight);
  const visibleRange = calculateVisibleRange(
    state.scrollTop,
    containerHeight,
    itemHeight,
    totalItems,
  );
  const renderRange = calculateRenderRange(visibleRange, overscan, totalItems);

  return {
    ...state,
    containerHeight,
    totalHeight,
    visibleRange,
    renderRange,
  };
};

/**
 * Update viewport state when total items changes
 * Pure function - returns new state
 */
export const updateViewportItems = (
  state: ViewportState,
  itemHeight: number,
  totalItems: number,
  overscan: number,
): ViewportState => {
  const totalHeight = calculateTotalHeight(totalItems, itemHeight);
  const visibleRange = calculateVisibleRange(
    state.scrollTop,
    state.containerHeight,
    itemHeight,
    totalItems,
  );
  const renderRange = calculateRenderRange(visibleRange, overscan, totalItems);

  return {
    ...state,
    totalHeight,
    visibleRange,
    renderRange,
  };
};

// =============================================================================
// Range Utilities
// =============================================================================

/**
 * Check if two ranges are equal
 * Pure function - no side effects
 */
export const rangesEqual = (a: Range, b: Range): boolean => {
  return a.start === b.start && a.end === b.end;
};

/**
 * Check if an index is within a range
 * Pure function - no side effects
 */
export const isInRange = (index: number, range: Range): boolean => {
  return index >= range.start && index <= range.end;
};

/**
 * Get the count of items in a range
 * Pure function - no side effects
 */
export const getRangeCount = (range: Range): number => {
  if (range.end < range.start) return 0;
  return range.end - range.start + 1;
};

/**
 * Create an array of indices from a range
 * Pure function - no side effects
 */
export const rangeToIndices = (range: Range): number[] => {
  const indices: number[] = [];
  for (let i = range.start; i <= range.end; i++) {
    indices.push(i);
  }
  return indices;
};

/**
 * Calculate which indices need to be added/removed when range changes
 * Pure function - no side effects
 */
export const diffRanges = (
  oldRange: Range,
  newRange: Range,
): { add: number[]; remove: number[] } => {
  const add: number[] = [];
  const remove: number[] = [];

  // Find indices to remove (in old but not in new)
  for (let i = oldRange.start; i <= oldRange.end; i++) {
    if (i < newRange.start || i > newRange.end) {
      remove.push(i);
    }
  }

  // Find indices to add (in new but not in old)
  for (let i = newRange.start; i <= newRange.end; i++) {
    if (i < oldRange.start || i > oldRange.end) {
      add.push(i);
    }
  }

  return { add, remove };
};
