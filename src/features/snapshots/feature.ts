/**
 * vlist/snapshots - Builder Feature
 * Adds scroll save/restore for SPA navigation and tab switching.
 *
 * Priority: 50 (runs last — needs all other features initialized)
 *
 * What it wires:
 * - getScrollSnapshot() — captures current scroll position (item index + sub-pixel offset)
 * - restoreScroll() — restores scroll position from snapshot
 *
 * Snapshots capture the first visible item index and the pixel offset within
 * that item — not raw scrollTop. This means:
 * - Snapshots survive list recreation (navigate away and back)
 * - Snapshots work correctly with compression (1M+ items)
 * - Snapshots include selection state if selection is installed
 *
 * Added methods: getScrollSnapshot, restoreScroll
 */

import type { VListItem, ScrollSnapshot } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a snapshots feature for the builder.
 *
 * Adds scroll save/restore for SPA navigation and tab switching.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withSnapshots } from 'vlist/snapshots'
 *
 * const list = vlist({ ... })
 *   .use(withSnapshots())
 *   .build()
 *
 * // Save before navigating away
 * const snapshot = list.getScrollSnapshot()
 * sessionStorage.setItem('list-scroll', JSON.stringify(snapshot))
 *
 * // Restore when coming back
 * const saved = JSON.parse(sessionStorage.getItem('list-scroll'))
 * if (saved) list.restoreScroll(saved)
 * ```
 */
export const withSnapshots = <
  T extends VListItem = VListItem,
>(): VListFeature<T> => {
  return {
    name: "withSnapshots",
    priority: 50,

    methods: ["getScrollSnapshot", "restoreScroll"] as const,

    setup(ctx: BuilderContext<T>): void {
      // ── getScrollSnapshot ──
      ctx.methods.set("getScrollSnapshot", (): ScrollSnapshot => {
        const scrollTop = ctx.scrollController.getScrollTop();
        const compression = ctx.getCachedCompression();
        const totalItems = ctx.getVirtualTotal();

        // Check if selection feature registered getSelected
        const getSelected = ctx.methods.get("getSelected") as
          | (() => Array<string | number>)
          | undefined;
        const selectedIds =
          getSelected && getSelected().length > 0 ? getSelected() : undefined;

        if (totalItems === 0) {
          const snapshot: ScrollSnapshot = { index: 0, offsetInItem: 0 };
          if (selectedIds) snapshot.selectedIds = selectedIds;
          return snapshot;
        }

        let index: number;
        let offsetInItem: number;

        if (compression.isCompressed) {
          // Compressed: scroll position maps linearly to item index
          const scrollRatio = scrollTop / compression.virtualSize;
          const exactIndex = scrollRatio * totalItems;
          index = Math.max(0, Math.min(Math.floor(exactIndex), totalItems - 1));
          const fraction = exactIndex - index;
          offsetInItem = fraction * ctx.sizeCache.getSize(index);
        } else {
          // Normal: direct offset lookup
          index = ctx.sizeCache.indexAtOffset(scrollTop);
          offsetInItem = scrollTop - ctx.sizeCache.getOffset(index);
        }

        // Clamp offsetInItem to non-negative (floating point edge cases)
        offsetInItem = Math.max(0, offsetInItem);

        const snapshot: ScrollSnapshot = { index, offsetInItem };
        if (selectedIds) snapshot.selectedIds = selectedIds;
        return snapshot;
      });

      // ── restoreScroll ──
      ctx.methods.set("restoreScroll", (snapshot: ScrollSnapshot): void => {
        const { index, offsetInItem, selectedIds } = snapshot;
        const compression = ctx.getCachedCompression();
        const totalItems = ctx.getVirtualTotal();

        if (totalItems === 0) return;

        const safeIndex = Math.max(0, Math.min(index, totalItems - 1));
        let scrollPosition: number;

        if (compression.isCompressed) {
          // Compressed: reverse the linear mapping
          const itemSize = ctx.sizeCache.getSize(safeIndex);
          const fraction = itemSize > 0 ? offsetInItem / itemSize : 0;
          scrollPosition =
            ((safeIndex + fraction) / totalItems) * compression.virtualSize;
        } else {
          // Normal: direct offset
          scrollPosition = ctx.sizeCache.getOffset(safeIndex) + offsetInItem;
        }

        // Clamp to valid range
        const maxScroll = Math.max(
          0,
          compression.virtualSize - ctx.state.viewportState.containerSize,
        );
        scrollPosition = Math.max(0, Math.min(scrollPosition, maxScroll));

        ctx.scrollController.scrollTo(scrollPosition);

        // Restore selection if provided and selection feature is present
        if (selectedIds && selectedIds.length > 0) {
          const selectFn = ctx.methods.get("select") as
            | ((...ids: Array<string | number>) => void)
            | undefined;
          if (selectFn) {
            selectFn(...selectedIds);
          }
        }
      });
    },
  };
};
