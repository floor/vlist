/**
 * vlist — logical scroll handlers (RFC-012)
 *
 * A handler that owns the logical position itself, instead of reading it from
 * a native scroll offset: the synthetic driver (`scroll.mode`, RFC-014/015) and
 * the carousel's wrap runway. Both render through `state.baseOffset`: items are
 * placed at `getOffset(index) - baseOffset`, so the content element never has
 * to be as large as the list.
 */

import type { SizeCache } from "./sizes";
import type { EngineState } from "./state";
import type { ScrollHandler } from "./scroll";

export interface LogicalScrollHandler extends ScrollHandler {
  /** Move to an absolute logical (virtual pixel) position; renders + schedules idle. */
  setLogical(logicalPx: number): void;
  /** Current absolute logical position (== state.scrollPosition). */
  getLogical(): number;
  /** Non-cancelling coordinate correction, when supported by the input provider. */
  shiftBy?(delta: number): void;
  /** Maximum scrollable logical position (`virtualTotal - containerSize`, >= 0). */
  getMaxLogical(): number;
  /** Recompute derived geometry from the total size and resize the content element. */
  refresh(totalSize: number): void;
}

/**
 * Infinite-loop (wrap) configuration for a logical handler (carousel, RFC-011).
 *
 * In wrap mode the logical position is never clamped to a maximum: instead it is
 * periodically folded back toward {@link home} by whole laps once it drifts more
 * than {@link thresholdLaps} laps away. Because the consumer maps virtual indices
 * to real items via `index % realTotal`, shifting the logical position (and
 * baseOffset) by a whole lap leaves the rendered items and their on-screen
 * positions unchanged — the loop is seamless. The content element stays a few
 * viewports long, so large item counts never blow the browser's element-size
 * limit.
 */
export interface WrapConfig {
  /** Current lap period in virtual px (`realTotal × stepSize`). */
  readonly lapSize: () => number;
  /**
   * Real items in one lap (e.g. the carousel's `realTotal`). The wrap handler
   * uses this to re-key mounted elements on a fold so the same DOM nodes
   * survive the virtual-index shift — only the key changed; paint did not.
   */
  readonly itemsPerLap: () => number;
  /** Logical position to fold back toward (the home lap). */
  readonly home: () => number;
  /** Fold the logical position back toward `home` once it drifts this many laps away. */
  readonly thresholdLaps: number;
  /** @internal Notify the wrap owner when its logical coordinates fold. */
  readonly onFold?: (shift: number) => void;
}

export interface LogicalScrollConfig {
  /** Logical row geometry for opt-in input providers (keyboard row steps). */
  readonly sizeCache?: Pick<SizeCache, "getSize" | "indexAtOffset" | "getTotalSize">;
  readonly state: EngineState;
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
  readonly isX: boolean;
  readonly wheelEnabled: boolean;
  readonly idleTimeout: number;
  readonly scrollTarget?: EventTarget;
  /** Main-axis padding folded into the virtual total (matches native content sizing). */
  readonly mainAxisPadding: number;
  /** Runway size as a multiple of the viewport (defaults to RUNWAY_FACTOR). */
  readonly runwayFactor?: number;
  /** Infinite-loop config (carousel). When set, the logical position wraps by
   *  whole laps toward `home` instead of clamping to a maximum. */
  readonly wrap?: WrapConfig;
  /**
   * Mounted row map. A wrap fold re-keys it in place so phase 2 finds the
   * same nodes; omitted when the handler is constructed without a viewport.
   */
  readonly rendered?: Map<number, HTMLElement>;
  /**
   * Class prefix for rewriting `id` / `aria-activedescendant` on a wrap fold.
   * Passed explicitly — a prefix containing `-content` cannot be recovered
   * from the content element's class name.
   */
  readonly classPrefix?: string;
  /**
   * Stripe class (`{prefix}-item--odd`). Re-toggled on a wrap fold when
   * `indexShift` is odd, so virtual-index parity survives the re-key.
   */
  readonly oddClass?: string;
  /** @internal Coordinate fold: shift core telemetry references before rendering. */
  readonly onFold?: (shift: number) => void;
  /** Called synchronously per frame — triggers the 2-phase pipeline. */
  readonly onFrame: () => void;
  /** Called when scrolling becomes idle. */
  readonly onIdle: () => void;
}
