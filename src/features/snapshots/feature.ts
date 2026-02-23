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
// Config
// =============================================================================

/** Configuration for the snapshots feature. */
export interface SnapshotConfig {
  /**
   * Snapshot to restore automatically after `build()` completes.
   *
   * When provided, `restoreScroll(restore)` is scheduled via
   * `queueMicrotask` — it runs right after `.build()` returns but
   * before the browser paints, so the user never sees position 0.
   *
   * ```ts
   * const saved = sessionStorage.getItem('scroll');
   * const snapshot = saved ? JSON.parse(saved) : undefined;
   *
   * const list = vlist({ ... })
   *   .use(withAsync({
   *     adapter,
   *     autoLoad: !snapshot,                 // skip autoLoad when restoring
   *     total: snapshot?.total,              // from snapshot — no hardcoded constant needed
   *   }))
   *   .use(withSnapshots({ restore: snapshot })) // auto-restores after build()
   *   .build();
   * ```
   */
  restore?: ScrollSnapshot;
}

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
export const withSnapshots = <T extends VListItem = VListItem>(
  config?: SnapshotConfig,
): VListFeature<T> => {
  const restoreSnapshot = config?.restore;

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
          const snapshot: ScrollSnapshot = { index: 0, offsetInItem: 0, total: 0 };
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

        const snapshot: ScrollSnapshot = { index, offsetInItem, total: totalItems };
        if (selectedIds) snapshot.selectedIds = selectedIds;
        return snapshot;
      });

      // ── restoreScroll ──
      const restoreScroll = (snapshot: ScrollSnapshot): void => {
        const { index, offsetInItem, selectedIds } = snapshot;
        const totalItems = ctx.getVirtualTotal();

        // If total is 0, we cannot restore scroll position yet.
        // The caller should provide initialTotal when creating the list
        // (or include total in the snapshot via withAsync({ total: snapshot?.total })).
        if (totalItems === 0) {
          return;
        }

        // Guard against corrupt snapshot data (NaN, undefined parsed from JSON)
        if (!Number.isFinite(index) || !Number.isFinite(offsetInItem)) {
          return;
        }

        // ── Ensure sizeCache, compression, and content size are current ──
        // When withAsync has autoLoad:false + initialTotal, the total is set
        // during setup() before isInitialized is true. The onStateChange
        // callback (which rebuilds sizeCache) is gated by isInitialized, so
        // sizeCache may still have total=0. Rebuild it now so compression
        // and virtualSize calculations use the correct total.
        const sizeCacheTotal = ctx.sizeCache.getTotal();
        if (sizeCacheTotal !== totalItems) {
          ctx.sizeCache.rebuild(totalItems);
          ctx.updateCompressionMode();
          const freshCompression = ctx.getCachedCompression();
          ctx.updateContentSize(freshCompression.virtualSize);
        }

        const compression = ctx.getCachedCompression();
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
          const offset = ctx.sizeCache.getOffset(safeIndex);
          scrollPosition = offset + offsetInItem;
        }

        // Clamp to valid range
        const containerSize = ctx.state.viewportState.containerSize;
        const maxScroll = Math.max(
          0,
          compression.virtualSize - containerSize,
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

        // If async feature provides loadVisibleRange, use it to load data
        // at the restored position without resetting the total/data.
        // This avoids the problem where reload() resets total to 0, which
        // shrinks the content, resets scrollTop to 0, and then loads from
        // offset 0 instead of the restored position.
        const loadVisibleFn = ctx.methods.get("loadVisibleRange") as
          | (() => Promise<void>)
          | undefined;

        if (loadVisibleFn) {
          // Wait a frame for the scroll position to settle and the viewport
          // state to update, then load visible data.
          requestAnimationFrame(() => {
            loadVisibleFn();
          });
        } else {
          // Fallback: if there's a reload method but no loadVisibleRange
          // (shouldn't happen with current withAsync, but defensive).
          const reloadFn = ctx.methods.get("reload") as
            | (() => Promise<void>)
            | undefined;
          if (reloadFn) {
            requestAnimationFrame(() => {
              reloadFn();
            });
          }
        }
      };

      ctx.methods.set("restoreScroll", restoreScroll);

      // ── Auto-restore ──
      // If a restore snapshot was provided via config, schedule restoration
      // via queueMicrotask. This runs right after build() returns (all
      // synchronous setup, isInitialized=true, initial render) but before
      // the browser paints — so the user never sees position 0.
      if (restoreSnapshot) {
        queueMicrotask(() => {
          restoreScroll(restoreSnapshot);
        });
      }
    },
  };
};