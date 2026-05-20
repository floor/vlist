/**
 * vlist v2 — 2-Phase Pipeline
 *
 * Phase 1: Calculate & Reconcile — zero allocation hot path.
 *   Reads scroll position + size cache, writes into EngineState TypedArrays.
 *
 * Phase 2: Commit — reads EngineState buffers, updates DOM via pool.
 *   Sub-phases: release → acquire → identity bind → position.
 *
 * Both phases are synchronous. No intermediate objects are allocated.
 */

import type { SizeCache } from "./sizes";
import type { VListItem, ItemTemplate, ItemState } from "../types";
import type { CompiledHooks, ElementPool } from "./types";
import type { EngineState } from "./state";
import { runCalculateHooks, runCommitHooks } from "./hooks";

// =============================================================================
// Phase 1 — Calculate & Reconcile
// =============================================================================

/**
 * Calculate visible range and fill EngineState buffers.
 * Zero allocation — all writes go into pre-allocated TypedArrays.
 *
 * v1 compliance:
 * - Zero container size early exit (v1 core.ts:745-751)
 * - Empty range sentinel: visibleCount = 0 (v1 {start:0, end:-1})
 * - Overscan application (v1 range.ts:44-50)
 * - Render count safety cap (v1 core.ts:765-778)
 */
export function phase1Calculate(
  state: EngineState,
  sizeCache: SizeCache,
  overscan: number,
  hooks: CompiledHooks,
  startPadding?: number,
): void {
  if (state.containerSize <= 0 || state.totalItems === 0) {
    state.clear();
    return;
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

  // Overscan (v1 range.ts:39-51)
  const renderStart = Math.max(0, visStart - overscan);
  const renderEnd = Math.min(totalItems - 1, visEnd + overscan);

  // Safety cap (v1 core.ts:765-778)
  const maxRender = Math.ceil(containerSize / 1) + overscan * 2 + 10;
  const count = renderEnd - renderStart + 1;
  const safeCap = Math.min(count, state.capacity, maxRender);

  // Range-unchanged fast path (v1 core.ts:780-809)
  if (renderStart === state.prevRangeStart && renderEnd === state.prevRangeEnd && !state.renderPending) {
    return;
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
}

// =============================================================================
// Phase 2 — Commit (DOM Update)
// =============================================================================

/** Reusable ItemState singleton — never allocated per frame */
const itemState: ItemState = { selected: false, focused: false };

export function phase2Commit<T extends VListItem>(
  state: EngineState,
  pool: ElementPool,
  contentElement: HTMLElement,
  template: ItemTemplate<T>,
  getItems: () => readonly T[],
  rendered: Map<number, HTMLElement>,
  horizontal: boolean,
  hooks: CompiledHooks,
  getItemFn?: ((index: number) => T | undefined) | null,
  itemStateFn?: ((index: number, state: ItemState) => void) | null,
  classPrefix?: string,
  interactive?: boolean,
  startPadding?: number,
  crossPadStart?: number,
  crossPadEnd?: number,
  oddClass?: string,
): void {
  const prefix = classPrefix ?? "vlist";
  const selectedClass = itemStateFn ? `${prefix}-item--selected` : "";
  const focusedClass = itemStateFn ? `${prefix}-item--focused` : "";
  const items = getItemFn ? null : getItems();
  const count = state.visibleCount;
  const newIndices = state.visibleIndices;

  // Visible range bounds — indices are contiguous, so a range check
  // replaces the per-frame Set allocation for O(1) membership tests.
  const rangeStart = count > 0 ? newIndices[0]! : 0;
  const rangeEnd = count > 0 ? newIndices[count - 1]! : -1;

  // Release nodes no longer visible.
  // forEach avoids iterator/tuple allocations that for..of creates.
  rendered.forEach((element, idx) => {
    if (idx < rangeStart || idx > rangeEnd) {
      element.remove();
      pool.release(element);
      rendered.delete(idx);
    }
  });

  // Acquire, bind identity, position
  const translateProp = horizontal ? "translateX(" : "translateY(";
  const itemRole = interactive ? "option" : "listitem";
  const ariaTotal = interactive ? String(state.totalItems) : "";
  const totalChanged = interactive && state.totalItems !== state.prevAriaTotal;
  const sp = startPadding ?? 0;
  const cps = crossPadStart ?? 0;
  const cpe = crossPadEnd ?? 0;
  const hasCrossPad = cps !== 0 || cpe !== 0;
  const crossStartProp = hasCrossPad ? (horizontal ? "top" : "left") : "";
  const crossEndProp = hasCrossPad ? (horizontal ? "bottom" : "right") : "";
  const crossStartVal = hasCrossPad ? cps + "px" : "";
  const crossEndVal = hasCrossPad ? cpe + "px" : "";

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

    if (element === undefined) {
      element = pool.acquire();

      if (item !== undefined) {
        const result = template(item, dataIndex, itemState);
        if (typeof result === "string") {
          element.innerHTML = result;
        } else {
          element.innerHTML = "";
          element.appendChild(result);
        }
      }

      element.setAttribute("role", itemRole);
      element.setAttribute("data-index", String(dataIndex));
      if (interactive) {
        element.id = prefix + "-item-" + dataIndex;
        element.setAttribute("aria-posinset", String(dataIndex + 1));
        element.setAttribute("aria-setsize", ariaTotal);
      }
      if (item !== undefined) {
        element.setAttribute("data-id", String(item.id));
      }

      if (hasCrossPad) {
        element.style[crossStartProp] = crossStartVal;
        element.style[crossEndProp] = crossEndVal;
      }

      rendered.set(dataIndex, element);
      contentElement.appendChild(element);
    } else {
      if (totalChanged) {
        element.setAttribute("aria-setsize", ariaTotal);
      }
      if (item !== undefined && element.getAttribute("data-id") !== String(item.id)) {
        const result = template(item, dataIndex, itemState);
        if (typeof result === "string") {
          element.innerHTML = result;
        } else {
          element.innerHTML = "";
          element.appendChild(result);
        }
        element.setAttribute("data-id", String(item.id));
      }
    }

    if (itemStateFn) {
      element.classList.toggle(selectedClass, itemState.selected);
      element.classList.toggle(focusedClass, itemState.focused);
      if (itemState.selected) element.setAttribute("aria-selected", "true");
      else element.removeAttribute("aria-selected");
    }

    if (oddClass) element.classList.toggle(oddClass, (dataIndex & 1) === 1);

    element.style.transform = translateProp + (offset + sp) + "px)";
    if (horizontal) {
      element.style.width = size + "px";
    } else {
      element.style.height = size + "px";
    }
  }

  if (interactive) state.prevAriaTotal = state.totalItems;

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
  horizontal: boolean,
  hooks: CompiledHooks,
  getItemFn?: ((index: number) => T | undefined) | null,
  itemStateFn?: ((index: number, state: ItemState) => void) | null,
  classPrefix?: string,
  interactive?: boolean,
  startPadding?: number,
  crossPadStart?: number,
  crossPadEnd?: number,
  oddClass?: string,
): void {
  phase1Calculate(state, sizeCache, overscan, hooks, startPadding);
  phase2Commit(state, pool, contentElement, template, getItems, rendered, horizontal, hooks, getItemFn, itemStateFn, classPrefix, interactive, startPadding, crossPadStart, crossPadEnd, oddClass);
}
