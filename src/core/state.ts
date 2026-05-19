/**
 * vlist v2 — EngineState
 *
 * Persistent singleton instantiated once during createVList().
 * All hot-path state lives in pre-allocated TypedArrays.
 * Phase 1 mutates in place. Phase 2 reads directly. Zero allocation.
 */

import { OVERSCAN } from "../constants";

export class EngineState {
  /** Data indices of visible items — Phase 1 writes, Phase 2 reads */
  public visibleIndices: Int32Array;

  /** Pixel offsets along main axis for each visible item */
  public visibleOffsets: Float64Array;

  /** Sizes along main axis for each visible item */
  public visibleSizes: Float64Array;

  /** Number of valid entries in the buffers (0 = empty range sentinel) */
  public visibleCount: number = 0;

  /** First data index in the visible window (contiguous layouts) */
  public startIndex: number = 0;

  /** Total content size in pixels */
  public totalSize: number = 0;

  /** Current buffer capacity */
  public capacity: number;

  // ── Scroll state (mutated by scroll handler, no allocation) ──────

  public scrollPosition: number = 0;
  public prevScrollPosition: number = 0;

  /** 1 = forward, -1 = backward, 0 = idle */
  public scrollDirection: number = 0;

  // ── Container state (updated on resize, cold path) ───────────────

  public containerSize: number = 0;
  public crossSize: number = 0;
  public totalItems: number = 0;

  // ── Render state (for range-unchanged fast path) ─────────────────

  public prevRangeStart: number = 0;
  public prevRangeEnd: number = -1;
  public renderPending: boolean = false;
  public initialized: boolean = false;
  public destroyed: boolean = false;

  // ── Compression state ────────────────────────────────────────────

  public isCompressed: boolean = false;
  public compressionRatio: number = 1;

  constructor(initialCapacity: number) {
    this.capacity = initialCapacity;
    this.visibleIndices = new Int32Array(initialCapacity);
    this.visibleOffsets = new Float64Array(initialCapacity);
    this.visibleSizes = new Float64Array(initialCapacity);
  }

  /**
   * Resize buffers when container changes. Cold path only.
   * v1-compatible heuristic: capacity = ceil(containerSize / minItemSize) + overscan * 2
   */
  resizeCapacity(containerSize: number, minItemSize: number, overscan: number = OVERSCAN): void {
    if (minItemSize <= 0 || containerSize <= 0) return;

    const needed = Math.ceil(containerSize / minItemSize) + overscan * 2;
    if (needed <= this.capacity) return;

    const newCapacity = needed + 8;
    this.visibleIndices = new Int32Array(newCapacity);
    this.visibleOffsets = new Float64Array(newCapacity);
    this.visibleSizes = new Float64Array(newCapacity);
    this.capacity = newCapacity;
  }

  /** Reset to empty range sentinel. visibleCount = 0 matches v1 {start:0, end:-1}. */
  clear(): void {
    this.visibleCount = 0;
    this.startIndex = 0;
  }
}
