/**
 * vlist v2 — EngineState
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

  // ── Compression state ────────────────────────────────────────────

  isCompressed: boolean;
  compressionRatio: number;

  // ── ARIA tracking (for aria-setsize freshness) ───────────────────

  prevAriaTotal: number;

  /**
   * Resize buffers when container changes. Cold path only.
   * v1-compatible heuristic: capacity = ceil(containerSize / minItemSize) + overscan * 2
   */
  resizeCapacity(containerSize: number, minItemSize: number, overscan?: number): void;

  /** Reset to empty range sentinel. visibleCount = 0 matches v1 {start:0, end:-1}. */
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

    containerSize: 0,
    crossSize: 0,
    totalItems: 0,

    prevRangeStart: 0,
    prevRangeEnd: -1,
    renderPending: false,
    initialized: false,
    destroyed: false,

    isCompressed: false,
    compressionRatio: 1,

    prevAriaTotal: -1,

    resizeCapacity(containerSize: number, minItemSize: number, overscan: number = OVERSCAN): void {
      if (minItemSize <= 0 || containerSize <= 0) return;

      const needed = Math.ceil(containerSize / minItemSize) + overscan * 2;
      if (needed <= state.capacity) return;

      const newCapacity = needed + 8;
      state.visibleIndices = new Int32Array(newCapacity);
      state.visibleOffsets = new Float64Array(newCapacity);
      state.visibleSizes = new Float64Array(newCapacity);
      state.capacity = newCapacity;
    },

    clear(): void {
      state.visibleCount = 0;
      state.startIndex = 0;
    },
  };

  return state;
}
