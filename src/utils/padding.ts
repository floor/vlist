// src/utils/padding.ts
/**
 * vlist/utils — Padding Resolution
 * Shared helpers for resolving the CSS-shorthand padding config into
 * concrete pixel values. Used by core (to apply CSS) and by features
 * (to subtract cross-axis padding from container dimensions).
 */

import type { BuilderConfig } from "../builder/types";

// =============================================================================
// Types
// =============================================================================

/** Padding config — re-exported from BuilderConfig for convenience */
export type PaddingConfig = NonNullable<BuilderConfig["padding"]>;

/** Resolved padding — all four sides in pixels */
export interface ResolvedPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

// =============================================================================
// Resolve All Sides
// =============================================================================

/** Zero padding singleton — avoids allocation when padding is undefined */
const ZERO: ResolvedPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Resolve a padding config into all four sides.
 *
 * - `undefined`        → { 0, 0, 0, 0 }
 * - `number`           → equal on all sides
 * - `[v, h]`           → top/bottom = v, left/right = h
 * - `[t, r, b, l]`     → per-side (CSS order)
 *
 * Returns a frozen singleton for the zero case (no allocation).
 */
export const resolvePadding = (
  padding: PaddingConfig | undefined,
): ResolvedPadding => {
  if (padding == null) return ZERO;

  if (typeof padding === "number") {
    return padding === 0 ? ZERO : { top: padding, right: padding, bottom: padding, left: padding };
  }

  if (padding.length === 2) {
    const [v, h] = padding;
    return (v === 0 && h === 0) ? ZERO : { top: v, right: h, bottom: v, left: h };
  }

  const [top, right, bottom, left] = padding;
  return (top === 0 && right === 0 && bottom === 0 && left === 0)
    ? ZERO
    : { top, right, bottom, left };
};

// =============================================================================
// Axis Helpers
// =============================================================================

/**
 * Total padding along the main axis (scroll direction).
 * Vertical → top + bottom. Horizontal → left + right.
 */
export const mainAxisPaddingFrom = (p: ResolvedPadding, isHorizontal: boolean): number =>
  isHorizontal ? p.left + p.right : p.top + p.bottom;

/**
 * Total padding along the cross axis (perpendicular to scroll).
 * Vertical → left + right. Horizontal → top + bottom.
 */
export const crossAxisPaddingFrom = (p: ResolvedPadding, isHorizontal: boolean): number =>
  isHorizontal ? p.top + p.bottom : p.left + p.right;