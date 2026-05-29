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
import type { VListItem, ItemTemplate, ItemState, VListEvents } from "../types";
import type { CompiledHooks, ElementPool } from "./types";
import type { EngineState } from "./state";
import type { Emitter } from "../events";
import { runCalculateHooks, runCommitHooks } from "./hooks";
import { neutralizeFocusable } from "./dom";
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
  readonly sizeProp: "width" | "height";
  itemRole: "option" | "listitem";
  interactive: boolean;
  readonly startPadding: number;
  readonly gap: number;
  readonly hasCrossPad: boolean;
  readonly crossStartProp: string;
  readonly crossEndProp: string;
  readonly crossStartVal: string;
  readonly crossEndVal: string;
  readonly oddClass: string;
  readonly emitter: Emitter<VListEvents> | null;
}

export function createRenderConfig(
  classPrefix: string,
  isX: boolean,
  startPadding: number,
  crossPadStart: number,
  crossPadEnd: number,
  oddClass: string,
  gap: number,
  emitter?: Emitter<VListEvents> | null,
): RenderConfig {
  const hasCrossPad = crossPadStart !== 0 || crossPadEnd !== 0;
  return {
    prefix: classPrefix,
    selectedClass: `${classPrefix}-item--selected`,
    focusedClass: `${classPrefix}-item--focused`,
    placeholderClass: `${classPrefix}-item--placeholder`,
    replacedClass: `${classPrefix}-item--replaced`,
    translateProp: isX ? "translateX(" : "translateY(",
    sizeProp: isX ? "width" : "height",
    itemRole: "listitem",
    interactive: false,
    startPadding,
    gap,
    hasCrossPad,
    crossStartProp: hasCrossPad ? (isX ? "top" : "left") : "",
    crossEndProp: hasCrossPad ? (isX ? "bottom" : "right") : "",
    crossStartVal: hasCrossPad ? crossPadStart + "px" : "",
    crossEndVal: hasCrossPad ? crossPadEnd + "px" : "",
    oddClass,
    emitter: emitter ?? null,
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

/** Check if visibleIndices[0..count) form a strictly consecutive sequence. */
function isContiguousWindow(indices: Int32Array, count: number): boolean {
  if (count <= 1) return true;
  let prev = indices[0]!;
  for (let i = 1; i < count; i++) {
    const next = indices[i]!;
    if (next !== prev + 1) return false;
    prev = next;
  }
  return true;
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

  let fragment: DocumentFragment | null = null;

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
        let result: string | HTMLElement;
        try {
          result = template(item, dataIndex, itemState);
        } catch (err: unknown) {
          if (rc.emitter) {
            rc.emitter.emit("error", {
              error: err instanceof Error ? err : new Error(String(err)),
              context: `template:render:${dataIndex}`,
            });
          }
          pool.release(acquired);
          continue;
        }
        if (typeof result === "string") {
          acquired.innerHTML = result;
        } else {
          acquired.textContent = "";
          acquired.appendChild(result);
        }
        neutralizeFocusable(acquired);
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
      acquired.style[rc.sizeProp] = sizeVal + "px";
      acquired._lastSize = sizeVal;

      acquired._lastItem = item;
      rendered.set(dataIndex, acquired);
      if (fragment === null) fragment = document.createDocumentFragment();
      fragment.appendChild(acquired);
    } else {
      if (totalChanged) {
        element.setAttribute("aria-setsize", ariaTotal);
      }
      if (item !== undefined && el._lastItem !== item) {
        const oldId = element.getAttribute("data-id");
        const newId = String(item.id);
        let result: string | HTMLElement;
        try {
          result = template(item, dataIndex, itemState);
        } catch (err: unknown) {
          if (rc.emitter) {
            rc.emitter.emit("error", {
              error: err instanceof Error ? err : new Error(String(err)),
              context: `template:render:${dataIndex}`,
            });
          }
          continue;
        }
        if (typeof result === "string") {
          element.innerHTML = result;
        } else {
          element.textContent = "";
          element.appendChild(result);
        }
        neutralizeFocusable(element);
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
        element.style[rc.sizeProp] = sizeVal + "px";
        el._lastSize = sizeVal;
      }
    }
  }

  // Flush all new elements in one DOM operation
  if (fragment !== null) contentElement.appendChild(fragment);

  // Release nodes no longer visible (after acquire so new elements are in the
  // DOM before stale ones are removed — no single-frame gaps).
  if (count > 0 && isContiguousWindow(newIndices, count)) {
    const rangeStart = newIndices[0]!;
    const rangeEnd = newIndices[count - 1]!;
    for (const [idx, element] of rendered) {
      if (idx < rangeStart || idx > rangeEnd) {
        element.remove();
        pool.release(element);
        rendered.delete(idx);
      }
    }
  } else {
    for (const [idx, element] of rendered) {
      if (!isInVisible(newIndices, count, idx)) {
        element.remove();
        pool.release(element);
        rendered.delete(idx);
      }
    }
  }

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
