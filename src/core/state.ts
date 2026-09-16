/**
 * vlist — EngineState
 *
 * Persistent singleton instantiated once during createVList().
 * All hot-path state lives in pre-allocated TypedArrays.
 * Phase 1 mutates in place. Phase 2 reads directly. Zero allocation.
 */

import { OVERSCAN } from "../constants";

export interface EngineState {
  /** Data indices of visible items — Phase 1 writes, Phase 2 reads */
  visibleIndices: Int32Array;

  /** Pixel offsets along main axis for each visible item */
  visibleOffsets: Float64Array;

  /** Sizes along main axis for each visible item */
  visibleSizes: Float64Array;

  /** Number of valid entries in the buffers (0 = empty range sentinel) */
  visibleCount: number;

  /** First data index in the visible window (contiguous layouts) */
  startIndex: number;

  /** Total content size in pixels */
  totalSize: number;

  /** Current buffer capacity */
  capacity: number;

  // ── Scroll state (mutated by scroll handler, no allocation) ──────

  scrollPosition: number;
  prevScrollPosition: number;

  /** 1 = forward, -1 = backward, 0 = idle */
  scrollDirection: number;

  /**
   * Bounded logical-scroll origin (RFC-012). The virtual offset that maps to
   * native scrollTop=0. Items render at `getOffset(index) - baseOffset`.
   * Defaults to 0, which makes native mode byte-identical (`offset - 0`).
   */
  baseOffset: number;
  /** baseOffset at the last phase-1 commit; a change forces phase 2 even when the range is unchanged. */
  prevBaseOffset: number;

  // ── Container state (updated on resize, cold path) ───────────────

  containerSize: number;
  crossSize: number;
  totalItems: number;

  // ── Render state (for range-unchanged fast path) ─────────────────

  prevRangeStart: number;
  prevRangeEnd: number;
  renderPending: boolean;
  initialized: boolean;
  destroyed: boolean;

  // ── ARIA tracking (for aria-setsize freshness) ───────────────────

  prevAriaTotal: number;

  /**
   * Resize buffers when container changes. Cold path only.
   * Heuristic: capacity = ceil(containerSize / minItemSize) + overscan * 2
   */
  /**
   * Grow buffers to hold at least `needed` entries. Cold path only.
   *
   * The render window is the authority on how many entries are required. The
   * container/minItemSize heuristic below is only an estimate, and for a size
   * function there is no knowable minimum to estimate from.
   */
  ensureCapacity(needed: number): void;

  resizeCapacity(containerSize: number, minItemSize: number, overscan?: number): void;

  /** Reset to empty range sentinel. */
  clear(): void;
}

export function createEngineState(initialCapacity: number): EngineState {
  const state: EngineState = {
    visibleIndices: new Int32Array(initialCapacity),
    visibleOffsets: new Float64Array(initialCapacity),
    visibleSizes: new Float64Array(initialCapacity),
    visibleCount: 0,
    startIndex: 0,
    totalSize: 0,
    capacity: initialCapacity,

    scrollPosition: 0,
    prevScrollPosition: 0,
    scrollDirection: 0,
    baseOffset: 0,
    prevBaseOffset: 0,

    containerSize: 0,
    crossSize: 0,
    totalItems: 0,

    prevRangeStart: 0,
    prevRangeEnd: -1,
    renderPending: false,
    initialized: false,
    destroyed: false,

    prevAriaTotal: -1,

    ensureCapacity(needed: number): void {
      if (needed <= state.capacity) return;

      const newCapacity = needed + 8;
      const newIndices = new Int32Array(newCapacity);
      const newOffsets = new Float64Array(newCapacity);
      const newSizes = new Float64Array(newCapacity);
      newIndices.set(state.visibleIndices);
      newOffsets.set(state.visibleOffsets);
      newSizes.set(state.visibleSizes);
      state.visibleIndices = newIndices;
      state.visibleOffsets = newOffsets;
      state.visibleSizes = newSizes;
      state.capacity = newCapacity;
    },

    resizeCapacity(containerSize: number, minItemSize: number, overscan: number = OVERSCAN): void {
      if (minItemSize <= 0 || containerSize <= 0) return;
      state.ensureCapacity(Math.ceil(containerSize / minItemSize) + overscan * 2);
    },

    clear(): void {
      state.visibleCount = 0;
      state.startIndex = 0;
    },
  };

  return state;
}
