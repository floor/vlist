/**
 * vlist/test/helpers — Shared Factories
 *
 * Centralises the `TestItem` interface, `createTestItems()`, and
 * `createContainer()` helpers that are duplicated across test files.
 *
 * Usage:
 *   import { createTestItems, createContainer } from "../helpers/factory";
 *   import type { TestItem } from "../helpers/factory";
 */

import type { VListItem } from "../../src/types";

// =============================================================================
// TestItem
// =============================================================================

export interface TestItem extends VListItem {
  id: number;
  name: string;
  value?: number;
  [key: string]: unknown;
}

// =============================================================================
// createTestItems
// =============================================================================

/**
 * Create an array of simple test items.
 *
 * @param count  Number of items to generate.
 * @param startId  First item's `id` (default 1).
 * @returns Array of `{ id, name, value }` objects.
 */
export const createTestItems = (
  count: number,
  startId: number = 1,
): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Item ${startId + i}`,
    value: (startId + i) * 10,
  }));
};

// =============================================================================
// createContainer
// =============================================================================

export interface CreateContainerOptions {
  /** clientWidth reported by the element (default 300) */
  width?: number;
  /** clientHeight reported by the element (default 500) */
  height?: number;
  /** Whether to append to document.body (default true) */
  append?: boolean;
}

/**
 * Create a container `<div>` with configurable dimensions.
 *
 * Uses `Object.defineProperty` to set `clientWidth` and `clientHeight`
 * because JSDOM returns 0 for these by default.
 */
export const createContainer = (
  opts: CreateContainerOptions = {},
): HTMLElement => {
  const { width = 300, height = 500, append = true } = opts;

  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", {
    value: height,
    configurable: true,
  });
  Object.defineProperty(el, "clientWidth", {
    value: width,
    configurable: true,
  });

  if (append) {
    document.body.appendChild(el);
  }

  return el;
};

// =============================================================================
// Template helpers
// =============================================================================

/**
 * A simple template function suitable for most tests.
 */
export const simpleTemplate = (item: TestItem): string => {
  return `<div class="item">${item.name}</div>`;
};