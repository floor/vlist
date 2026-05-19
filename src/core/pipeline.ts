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
import { EngineState } from "./engine-state";
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
): void {
  if (state.containerSize <= 0 || state.totalItems === 0) {
    state.clear();
    return;
  }

  const scrollPos = state.scrollPosition;
  const containerSize = state.containerSize;
  const totalItems = state.totalItems;

  state.totalSize = sizeCache.getTotalSize();

  // Visible range (v1 range.ts:14-33)
  let visStart = sizeCache.indexAtOffset(scrollPos);
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
): void {
  const items = getItems();
  const count = state.visibleCount;
  const newIndices = state.visibleIndices;

  // Build set of indices in the new render window
  const newSet = new Set<number>();
  for (let i = 0; i < count; i++) {
    newSet.add(newIndices[i]!);
  }

  // Release nodes no longer visible
  for (const [idx, element] of rendered) {
    if (!newSet.has(idx)) {
      element.remove();
      pool.release(element);
      rendered.delete(idx);
    }
  }

  // Acquire, bind identity, position
  const translateProp = horizontal ? "translateX(" : "translateY(";

  for (let i = 0; i < count; i++) {
    const dataIndex = newIndices[i]!;
    const offset = state.visibleOffsets[i]!;
    const size = state.visibleSizes[i]!;
    const item = items[dataIndex];

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

      element.setAttribute("data-index", String(dataIndex));
      if (item !== undefined) {
        element.setAttribute("data-id", String(item.id));
      }

      rendered.set(dataIndex, element);
      contentElement.appendChild(element);
    }

    element.style.transform = translateProp + offset + "px)";
    if (horizontal) {
      element.style.width = size + "px";
    } else {
      element.style.height = size + "px";
    }
  }

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
): void {
  phase1Calculate(state, sizeCache, overscan, hooks);
  phase2Commit(state, pool, contentElement, template, getItems, rendered, horizontal, hooks);
}
