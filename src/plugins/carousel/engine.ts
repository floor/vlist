/**
 * vlist v2 — Carousel Layout Engine
 *
 * Computes per-item sizes and positions for carousel variants.
 * All MD3 variants use the same engine — the difference is the
 * slot configuration (how many items are visible and their ratios).
 *
 * A "slot" is a visible position in the carousel at rest.
 * During scroll, items transition between slots with smooth
 * size interpolation. The sum of all slot widths always equals
 * the container size.
 *
 * Example configurations:
 *   full:        slots [1.0]                focal 0
 *   hero:        slots [0.80, 0.20]         focal 0
 *   hero-center: slots [0.15, 0.70, 0.15]  focal 1
 *   multi:       slots [0.40, 0.30, 0.20, 0.10]  focal 0
 *   uncontained: slots [0.33, 0.34, 0.33]  focal 0
 */

// =============================================================================
// Types
// =============================================================================

export interface LayoutConfig {
  /** Slot ratios — must sum to 1.0. Each value is the fraction of containerSize. */
  slots: number[];
  /** Which slot is the focal/active one (0-indexed). */
  focalSlot: number;
  /** Container size in pixels along the primary axis. */
  containerSize: number;
  /** Gap between items in pixels (default: 0). Applied as visual spacing — does not affect step size. */
  gap?: number;
}

export interface ItemLayout {
  /** Pixel width (or height in vertical mode) of this item. */
  size: number;
  /** Absolute offset in content space. */
  offset: number;
  /** 0 = fully focal, 1 = fully exiting/entering. */
  progress: number;
  /** Relative index from the focal item. */
  relOffset: number;
  /** Size role based on progress. */
  role: "large" | "medium" | "small";
}

// =============================================================================
// Layout Engine
// =============================================================================

export function createLayoutEngine(config: LayoutConfig): {
  /** Slot widths in pixels at rest. */
  slotWidths: number[];
  /** Scroll distance to advance one item. */
  stepSize: number;
  /** Index of the focal slot. */
  focalSlot: number;
  /** Compute the layout for a single item given the scroll state. */
  getItemLayout(vi: number, focalVi: number, frac: number, anchor: number): ItemLayout;
  /** Compute the dynamic size of a single item (no offset calculation). */
  getItemSize(vi: number, focalVi: number, frac: number): number;
  /** Compute the anchor offset for pre-focal slots (centering). */
  getAnchorOffset(focalVi: number, frac: number): number;
} {
  const { slots, focalSlot, containerSize, gap: gapPx = 0 } = config;
  const slotCount = slots.length;

  // Resolve slot ratios to pixel widths.
  // The gap is distributed: each visible item is reduced by gapPx,
  // and the total gap space is (visibleItems - 1) * gapPx.
  // We account for this by resolving ratios against the available
  // space (containerSize minus total gap).
  const totalGap = Math.max(0, slotCount - 1) * gapPx;
  const availableSize = containerSize - totalGap;
  const slotWidths = slots.map(r => Math.round(r * availableSize));

  // Correct rounding errors — distribute remainder to the focal slot
  const roundingError = availableSize - slotWidths.reduce((a, b) => a + b, 0);
  if (focalSlot < slotWidths.length) slotWidths[focalSlot]! += roundingError;

  const stepSize = (slotWidths[focalSlot] ?? 0) + gapPx;

  /**
   * Compute the dynamic size of a single item based on its
   * position relative to the focal point and scroll fraction.
   *
   * During a transition (frac 0→1):
   * - Each slot's current item transitions OUT (shrinks to the next slot's size)
   * - The next item transitions IN (grows from the previous slot's size)
   *
   * The model ensures the sum of visible sizes always equals containerSize.
   */
  function getItemSize(vi: number, focalVi: number, frac: number): number {
    const rel = vi - focalVi;

    // Items transitioning through the slots
    // rel=0 is the outgoing focal, rel=1 is the incoming focal
    //
    // At rest (frac=0):
    //   rel = -focalSlot..-1 → leading peek slots
    //   rel = 0                → focal slot
    //   rel = 1..slotsAfter    → trailing peek slots
    //
    // During transition (frac=0→1):
    //   Each item moves one slot forward (rel decreases by 1 logically)
    //   A new item enters from the trailing edge

    // Determine which slot this item is transitioning FROM and TO
    const fromSlot = focalSlot + rel;
    const toSlot = fromSlot - 1;

    const fromSize = getSlotSize(fromSlot);
    const toSize = getSlotSize(toSlot);

    // Interpolate between the two slot sizes
    return fromSize + frac * (toSize - fromSize);
  }

  function getSlotSize(slotIndex: number): number {
    if (slotIndex < 0 || slotIndex >= slotCount) return 0;
    return slotWidths[slotIndex] ?? 0;
  }

  function getItemLayout(
    vi: number,
    focalVi: number,
    frac: number,
    anchor: number,
  ): ItemLayout {
    const rel = vi - focalVi;
    const size = getItemSize(vi, focalVi, frac);

    // Accumulate offset from the focal anchor outward.
    // Gap is added between each pair of visible items.
    let offset = anchor;
    if (rel > 0) {
      for (let r = 0; r < rel; r++) {
        const s = getItemSize(focalVi + r, focalVi, frac);
        offset += s + (s > 0 ? gapPx : 0);
      }
    } else if (rel < 0) {
      for (let r = -1; r >= rel; r--) {
        const s = getItemSize(focalVi + r, focalVi, frac);
        offset -= s + (s > 0 ? gapPx : 0);
      }
    }

    // Progress: 0 = fully focal, 1 = fully exiting
    const fromSlot = focalSlot + rel;
    const toSlot = fromSlot - 1;
    let progress: number;
    if (fromSlot === focalSlot) {
      progress = frac;
    } else if (toSlot === focalSlot) {
      progress = 1 - frac;
    } else {
      progress = 1;
    }

    // Role based on size relative to the largest slot
    const maxSlotSize = slotWidths[focalSlot] ?? 0;
    const sizeRatio = maxSlotSize > 0 ? size / maxSlotSize : 0;
    const role: "large" | "medium" | "small" =
      sizeRatio > 0.6 ? "large" : sizeRatio > 0.3 ? "medium" : "small";

    return { size, offset, progress, relOffset: rel, role };
  }

  function getAnchorOffset(focalVi: number, frac: number): number {
    if (focalSlot === 0) return 0;
    let offset = 0;
    for (let r = -1; r >= -focalSlot; r--) {
      const s = getItemSize(focalVi + r, focalVi, frac);
      offset += s + (s > 0 ? gapPx : 0);
    }
    return offset;
  }

  return { slotWidths, stepSize, focalSlot, getItemLayout, getItemSize, getAnchorOffset };
}

