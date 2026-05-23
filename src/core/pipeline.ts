/**
 * vlist v2 — 2-Phase Pipeline
 *
 * Phase 1: Calculate & Reconcile — zero allocation hot path.
 *   Reads scroll position + size cache, writes into EngineState TypedArrays.
 *
 * Phase 2: Commit — reads EngineState buffers, updates DOM via pool.
 *   Sub-phases: acquire → identity bind → position → release.
 *
 * Both phases are synchronous. No intermediate objects are allocated.
 */

import type { SizeCache } from "./sizes";
import type { VListItem, ItemTemplate, ItemState } from "../types";
import type { CompiledHooks, ElementPool } from "./types";
import type { EngineState } from "./state";
import { runCalculateHooks, runCommitHooks } from "./hooks";
import { PLACEHOLDER_ID_PREFIX } from "../constants";

// =============================================================================
// Render Configuration — resolved once at init, reused every frame
// =============================================================================

export interface RenderConfig {
  readonly prefix: string;
  readonly selectedClass: string;
  readonly focusedClass: string;
  readonly placeholderClass: string;
  readonly replacedClass: string;
  readonly translateProp: "translateX(" | "translateY(";
  readonly itemRole: "option" | "listitem";
  readonly interactive: boolean;
  readonly horizontal: boolean;
  readonly startPadding: number;
  readonly gap: number;
  readonly hasCrossPad: boolean;
  readonly crossStartProp: string;
  readonly crossEndProp: string;
  readonly crossStartVal: string;
  readonly crossEndVal: string;
  readonly oddClass: string;
}

export function createRenderConfig(
  classPrefix: string,
  horizontal: boolean,
  interactive: boolean,
  startPadding: number,
  crossPadStart: number,
  crossPadEnd: number,
  oddClass: string,
  gap: number,
): RenderConfig {
  const hasCrossPad = crossPadStart !== 0 || crossPadEnd !== 0;
  return {
    prefix: classPrefix,
    selectedClass: `${classPrefix}-item--selected`,
    focusedClass: `${classPrefix}-item--focused`,
    placeholderClass: `${classPrefix}-item--placeholder`,
    replacedClass: `${classPrefix}-item--replaced`,
    translateProp: horizontal ? "translateX(" : "translateY(",
    itemRole: interactive ? "option" : "listitem",
    interactive,
    horizontal,
    startPadding,
    gap,
    hasCrossPad,
    crossStartProp: hasCrossPad ? (horizontal ? "top" : "left") : "",
    crossEndProp: hasCrossPad ? (horizontal ? "bottom" : "right") : "",
    crossStartVal: hasCrossPad ? crossPadStart + "px" : "",
    crossEndVal: hasCrossPad ? crossPadEnd + "px" : "",
    oddClass,
  };
}

// =============================================================================
// Phase 1 — Calculate & Reconcile
// =============================================================================

/**
 * Calculate visible range and fill EngineState buffers.
 * Zero allocation — all writes go into pre-allocated TypedArrays.
 *
 * Guards:
 * - Zero container size early exit
 * - Empty range sentinel: visibleCount = 0
 * - Overscan application
 * - Render count safety cap
 */
export function phase1Calculate(
  state: EngineState,
  sizeCache: SizeCache,
  overscan: number,
  hooks: CompiledHooks,
  startPadding?: number,
): boolean {
  if (state.containerSize <= 0 || state.totalItems === 0) {
    state.clear();
    return true;
  }

  const scrollPos = state.scrollPosition;
  const containerSize = state.containerSize;
  const totalItems = state.totalItems;
  const sp = startPadding ?? 0;

  state.totalSize = sizeCache.getTotalSize();

  // Visible range — items are visually shifted by startPadding in the
  // transform, so subtract it from the range start lookup to avoid
  // missing items at the top of the viewport.
  let visStart = sizeCache.indexAtOffset(sp > 0 ? Math.max(0, scrollPos - sp) : scrollPos);
  let visEnd = sizeCache.indexAtOffset(scrollPos + containerSize);
  if (visEnd < totalItems - 1) visEnd++;
  visStart = Math.max(0, visStart);
  visEnd = Math.min(totalItems - 1, Math.max(0, visEnd));

  // Overscan
  const renderStart = Math.max(0, visStart - overscan);
  const renderEnd = Math.min(totalItems - 1, visEnd + overscan);

  // Safety cap
  const maxRender = Math.ceil(containerSize / 1) + overscan * 2 + 10;
  const count = renderEnd - renderStart + 1;
  const safeCap = Math.min(count, state.capacity, maxRender);

  // Range-unchanged fast path
  if (renderStart === state.prevRangeStart && renderEnd === state.prevRangeEnd && !state.renderPending) {
    return false;
  }

  // Fill TypedArray buffers
  state.visibleCount = safeCap;
  state.startIndex = renderStart;

  for (let i = 0; i < safeCap; i++) {
    const idx = renderStart + i;
    state.visibleIndices[i] = idx;
    state.visibleOffsets[i] = sizeCache.getOffset(idx);
    state.visibleSizes[i] = sizeCache.getSize(idx);
  }

  runCalculateHooks(hooks.calculate, state);

  state.prevRangeStart = renderStart;
  state.prevRangeEnd = renderEnd;
  state.renderPending = false;
  return true;
}

// =============================================================================
// Phase 2 — Commit (DOM Update)
// =============================================================================

/** Reusable ItemState singleton — never allocated per frame */
const itemState: ItemState = { selected: false, focused: false };

/** Linear scan for idx in visibleIndices[0..count). Handles arbitrary order. Zero allocation. */
function isInVisible(indices: Int32Array, count: number, idx: number): boolean {
  for (let i = 0; i < count; i++) {
    if (indices[i] === idx) return true;
  }
  return false;
}

/** Module-scope release state — avoids per-frame closure in rendered.forEach */
let _relIndices: Int32Array;
let _relCount: number;
let _relPool: ElementPool;
let _relRendered: Map<number, HTMLElement>;

function releaseIfNotVisible(element: HTMLElement, idx: number): void {
  if (!isInVisible(_relIndices, _relCount, idx)) {
    element.remove();
    _relPool.release(element);
    _relRendered.delete(idx);
  }
}

export function phase2Commit<T extends VListItem>(
  state: EngineState,
  pool: ElementPool,
  contentElement: HTMLElement,
  template: ItemTemplate<T>,
  getItems: () => readonly T[],
  rendered: Map<number, HTMLElement>,
  rc: RenderConfig,
  hooks: CompiledHooks,
  getItemFn?: ((index: number) => T | undefined) | null,
  itemStateFn?: ((index: number, state: ItemState) => void) | null,
): void {
  const items = getItemFn ? null : getItems();
  const count = state.visibleCount;
  const newIndices = state.visibleIndices;

  const ariaTotal = rc.interactive ? String(state.totalItems) : "";
  const totalChanged = rc.interactive && state.totalItems !== state.prevAriaTotal;

  for (let i = 0; i < count; i++) {
    const dataIndex = newIndices[i]!;
    const offset = state.visibleOffsets[i]!;
    const size = state.visibleSizes[i]!;
    const item = getItemFn ? getItemFn(dataIndex) : items![dataIndex];

    if (itemStateFn) {
      itemStateFn(dataIndex, itemState);
    } else {
      itemState.selected = false;
      itemState.focused = false;
    }

    let element = rendered.get(dataIndex);

    const el = element as HTMLElement & {
      _lastOffset?: number;
      _lastSize?: number;
      _lastSelected?: boolean;
      _lastFocused?: boolean;
      _lastItem?: unknown;
    };

    if (element === undefined) {
      const acquired = pool.acquire() as HTMLElement & {
        _lastOffset?: number;
        _lastSize?: number;
        _lastSelected?: boolean;
        _lastFocused?: boolean;
        _lastItem?: unknown;
      };

      if (item !== undefined) {
        const result = template(item, dataIndex, itemState);
        if (typeof result === "string") {
          acquired.innerHTML = result;
        } else {
          acquired.innerHTML = "";
          acquired.appendChild(result);
        }
      }

      acquired.setAttribute("role", rc.itemRole);
      acquired.setAttribute("data-index", String(dataIndex));
      if (rc.interactive) {
        acquired.id = rc.prefix + "-item-" + dataIndex;
        acquired.setAttribute("aria-posinset", String(dataIndex + 1));
        acquired.setAttribute("aria-setsize", ariaTotal);
      }
      if (item !== undefined) {
        const itemId = String(item.id);
        acquired.setAttribute("data-id", itemId);
        if (itemId.startsWith(PLACEHOLDER_ID_PREFIX)) {
          acquired.classList.add(rc.placeholderClass);
        }
      }

      if (rc.hasCrossPad) {
        acquired.style.setProperty(rc.crossStartProp, rc.crossStartVal);
        acquired.style.setProperty(rc.crossEndProp, rc.crossEndVal);
      }

      if (itemStateFn) {
        acquired.classList.toggle(rc.selectedClass, itemState.selected);
        acquired.classList.toggle(rc.focusedClass, itemState.focused);
        if (itemState.selected) acquired.setAttribute("aria-selected", "true");
        else acquired.removeAttribute("aria-selected");
        acquired._lastSelected = itemState.selected;
        acquired._lastFocused = itemState.focused;
      }

      if (rc.oddClass) acquired.classList.toggle(rc.oddClass, (dataIndex & 1) === 1);

      const transformOffset = offset + rc.startPadding;
      acquired.style.transform = rc.translateProp + transformOffset + "px)";
      acquired._lastOffset = transformOffset;

      const sizeVal = size - rc.gap;
      if (rc.horizontal) {
        acquired.style.width = sizeVal + "px";
      } else {
        acquired.style.height = sizeVal + "px";
      }
      acquired._lastSize = sizeVal;

      acquired._lastItem = item;
      rendered.set(dataIndex, acquired);
      contentElement.appendChild(acquired);
    } else {
      if (totalChanged) {
        element.setAttribute("aria-setsize", ariaTotal);
      }
      if (item !== undefined && el._lastItem !== item) {
        const oldId = element.getAttribute("data-id");
        const newId = String(item.id);
        const result = template(item, dataIndex, itemState);
        if (typeof result === "string") {
          element.innerHTML = result;
        } else {
          element.innerHTML = "";
          element.appendChild(result);
        }
        element.setAttribute("data-id", newId);
        el._lastItem = item;

        if (oldId !== newId) {
          const wasPlaceholder = oldId !== null && oldId.startsWith(PLACEHOLDER_ID_PREFIX);
          const isPlaceholder = newId.startsWith(PLACEHOLDER_ID_PREFIX);
          if (wasPlaceholder !== isPlaceholder) {
            element.classList.toggle(rc.placeholderClass, isPlaceholder);
          }
          if (wasPlaceholder && !isPlaceholder) {
            element.classList.add(rc.replacedClass);
            setTimeout(() => { element.classList.remove(rc.replacedClass); }, 300);
          }
        }
      }

      if (itemStateFn) {
        if (el._lastSelected !== itemState.selected) {
          element.classList.toggle(rc.selectedClass, itemState.selected);
          if (itemState.selected) element.setAttribute("aria-selected", "true");
          else element.removeAttribute("aria-selected");
          el._lastSelected = itemState.selected;
        }
        if (el._lastFocused !== itemState.focused) {
          element.classList.toggle(rc.focusedClass, itemState.focused);
          el._lastFocused = itemState.focused;
        }
      }

      const transformOffset = offset + rc.startPadding;
      if (el._lastOffset !== transformOffset) {
        element.style.transform = rc.translateProp + transformOffset + "px)";
        el._lastOffset = transformOffset;
      }

      const sizeVal = size - rc.gap;
      if (el._lastSize !== sizeVal) {
        if (rc.horizontal) {
          element.style.width = sizeVal + "px";
        } else {
          element.style.height = sizeVal + "px";
        }
        el._lastSize = sizeVal;
      }
    }
  }

  // Release nodes no longer visible (after acquire so new elements are in the
  // DOM before stale ones are removed — no single-frame gaps).
  _relIndices = newIndices;
  _relCount = count;
  _relPool = pool;
  _relRendered = rendered;
  rendered.forEach(releaseIfNotVisible);

  if (rc.interactive) state.prevAriaTotal = state.totalItems;

  runCommitHooks(hooks.commit, state);
}

// =============================================================================
// Full Render Cycle
// =============================================================================

export function render<T extends VListItem>(
  state: EngineState,
  sizeCache: SizeCache,
  overscan: number,
  pool: ElementPool,
  contentElement: HTMLElement,
  template: ItemTemplate<T>,
  getItems: () => readonly T[],
  rendered: Map<number, HTMLElement>,
  rc: RenderConfig,
  hooks: CompiledHooks,
  getItemFn?: ((index: number) => T | undefined) | null,
  itemStateFn?: ((index: number, state: ItemState) => void) | null,
): void {
  const changed = phase1Calculate(state, sizeCache, overscan, hooks, rc.startPadding);
  if (changed) {
    phase2Commit(state, pool, contentElement, template, getItems, rendered, rc, hooks, getItemFn, itemStateFn);
  }
}
