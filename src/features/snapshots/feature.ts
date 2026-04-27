/**
 * vlist/snapshots - Builder Feature
 * Adds scroll save/restore for SPA navigation and tab switching.
 *
 * Priority: 50 (runs last — needs all other features initialized)
 *
 * What it wires:
 * - getScrollSnapshot() — captures current scroll position (item index + sub-pixel offset)
 * - restoreScroll() — restores scroll position from snapshot
 * - autoSave — automatically saves snapshots to sessionStorage on scroll idle
 *   and selection change, and auto-restores on next build()
 *
 * Snapshots capture the first visible item index and the pixel offset within
 * that item — not raw scrollTop. This means:
 * - Snapshots survive list recreation (navigate away and back)
 * - Snapshots work correctly with compression (1M+ items)
 * - Snapshots include selection state if selection is installed
 *
 * Added methods: getScrollSnapshot, restoreScroll
 *
 * Helper:
 * - getAutoSaveSnapshot(key) — read a saved snapshot from sessionStorage
 *   so that withAsync can derive `autoLoad` and `total` from it.
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

  /**
   * Automatically save and restore snapshots via sessionStorage.
   *
   * Pass a string key to enable — snapshots are saved to
   * `sessionStorage` under that key whenever scroll becomes idle
   * or selection changes. On the next `build()`, the snapshot is
   * automatically restored if a matching key exists.
   *
   * This replaces the manual save/restore pattern — no event
   * listeners, debounce timers, or sessionStorage calls needed.
   *
   * ```ts
   * // That's it — save and restore are fully automatic:
   * const list = vlist({ ... })
   *   .use(withAsync({ adapter }))
   *   .use(withSnapshots({ autoSave: 'my-list-scroll' }))
   *   .build();
   * ```
   *
   * When `autoSave` is set, the `restore` option is ignored —
   * the saved snapshot is read from sessionStorage automatically.
   * The `autoLoad` and `total` options on `withAsync` are also
   * configured automatically (autoLoad is skipped when restoring,
   * and total is read from the snapshot).
   */
  autoSave?: string;
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
/**
 * Read a snapshot from sessionStorage by key.
 * Returns undefined if not found or corrupt.
 */
const readSnapshot = (key: string): ScrollSnapshot | undefined => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as ScrollSnapshot;
  } catch {
    return undefined;
  }
};


export const withSnapshots = <T extends VListItem = VListItem>(
  config?: SnapshotConfig,
): VListFeature<T> => {
  const autoSaveKey = config?.autoSave;

  // When autoSave is set, read the restore snapshot from sessionStorage
  // automatically — the `restore` option is ignored.
  const restoreSnapshot = autoSaveKey
    ? readSnapshot(autoSaveKey)
    : config?.restore;

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
          // Compressed: scroll position maps linearly to item index.
          // Use compression.virtualSize (not viewportState.totalSize) so
          // that save and restore use the exact same divisor — totalSize
          // includes compression slack which differs between runtime and
          // restore bootstrap, causing cumulative drift.
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

        // If total is 0 but the snapshot carries a total, bootstrap the
        // data manager so sizeCache/compression/content-height are correct
        // before we set the scroll position. This happens when reload()
        // was called with skipInitialLoad (no data fetched yet).
        if (totalItems === 0 && snapshot.total && snapshot.total > 0) {
          ctx.dataManager.setTotal(snapshot.total);
          // Rebuild sizeCache and compression with the new total
          ctx.sizeCache.rebuild(snapshot.total);
          ctx.updateCompressionMode();
          // withScale's enhancedUpdateCompressionMode already set the correct
          // content size (virtualSize + slack) when compressed. Only update it
          // ourselves for non-compressed lists — calling updateContentSize with
          // just virtualSize would strip the slack and make the last items unreachable.
          const freshCompression = ctx.getCachedCompression();
          if (!freshCompression.isCompressed) {
            ctx.updateContentSize(freshCompression.virtualSize);
          }
        } else if (totalItems === 0) {
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
        // Re-read virtual total (may have been updated by bootstrap above)
        const effectiveTotal = ctx.getVirtualTotal();
        const sizeCacheTotal = ctx.sizeCache.getTotal();
        if (sizeCacheTotal !== effectiveTotal) {
          ctx.sizeCache.rebuild(effectiveTotal);
          ctx.updateCompressionMode();
          // Same as above: withScale already updated content size with slack included.
          const freshCompression = ctx.getCachedCompression();
          if (!freshCompression.isCompressed) {
            ctx.updateContentSize(freshCompression.virtualSize);
          }
        }

        const compression = ctx.getCachedCompression();
        const safeIndex = Math.max(0, Math.min(index, effectiveTotal - 1));

        let scrollPosition: number;

        if (compression.isCompressed) {
          // Compressed: reverse the linear mapping.
          // Must use compression.virtualSize (same as save) for lossless roundtrip.
          const itemSize = ctx.sizeCache.getSize(safeIndex);
          const fraction = itemSize > 0 ? offsetInItem / itemSize : 0;
          scrollPosition =
            ((safeIndex + fraction) / effectiveTotal) * compression.virtualSize;
        } else {
          // Normal: direct offset
          const offset = ctx.sizeCache.getOffset(safeIndex);
          scrollPosition = offset + offsetInItem;
        }

        // Clamp to valid range.
        // When withScale is active, viewportState.totalSize = virtualSize + slack
        // (set by enhancedUpdateCompressionMode). Using just compression.virtualSize
        // here clips the last ~37 items off — the same drift bug as the original #12.
        // For non-compressed lists, totalSize === virtualSize, so this is safe either way.
        const containerSize = ctx.state.viewportState.containerSize;
        const effectiveTotalSize = compression.isCompressed
          ? ctx.state.viewportState.totalSize
          : compression.virtualSize;
        const maxScroll = Math.max(0, effectiveTotalSize - containerSize);
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
          // Wait for the viewport container to have a real size before loading.
          // On page reload, the ResizeObserver hasn't fired yet when restoreScroll
          // runs, so containerSize is 0 and forceRender produces renderRange {0,0}.
          // Poll with rAF until containerSize > 0 (typically 1-2 frames).
          const MAX_POLLS = 10;
          let polls = 0;
          const savedScrollPosition = scrollPosition;
          const pollUntilReady = (): void => {
            polls++;
            const cs = ctx.state.viewportState.containerSize;
            const currentScrollTop = ctx.scrollController.getScrollTop();
            if (cs > 0) {
              // Re-apply scroll position if it was lost (e.g. ResizeObserver
              // reset scrollTop when content size changed from 0 to real size)
              if (Math.abs(currentScrollTop - savedScrollPosition) > 1) {
                ctx.scrollController.scrollTo(savedScrollPosition);
              }
              loadVisibleFn();
            } else if (polls < MAX_POLLS) {
              requestAnimationFrame(pollUntilReady);
            }
          };
          requestAnimationFrame(pollUntilReady);
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

      // ── Auto-save ──
      // When autoSave is configured, save snapshots to sessionStorage
      // on scroll idle and selection change.
      //
      // During restore, ALL saves are guarded until the position has
      // settled. The first scroll:idle after restore marks the settle
      // point — we save once (capturing the fully settled state) and
      // lift the guard. After that, every idle and selection change
      // saves immediately.
      if (autoSaveKey) {
        let restoreGuard = !!restoreSnapshot;

        const saveToStorage = (): void => {
          if (restoreGuard) return;
          const getSnapshotFn = ctx.methods.get("getScrollSnapshot") as
            | (() => ScrollSnapshot)
            | undefined;
          if (!getSnapshotFn) return;
          const snap = getSnapshotFn();
          try {
            sessionStorage.setItem(autoSaveKey, JSON.stringify(snap));
          } catch {
            // sessionStorage full or unavailable — silently skip
          }
        };

        // Save on scroll idle (fires after scroll.idleTimeout, default 150ms).
        // During restore, the first idle lifts the guard and saves the
        // settled state. Subsequent idles save normally.
        ctx.idleHandlers.push(() => {
          if (restoreGuard) {
            restoreGuard = false;
          }
          saveToStorage();
        });

        // Save on selection change (guarded during restore like everything else)
        ctx.emitter.on("selection:change", saveToStorage);

        // ── Coordinate with withAsync ──
        // When restoring a snapshot, cancel withAsync's deferred autoLoad
        // and bootstrap the total from the snapshot. This eliminates the
        // need for the user to manually pass autoLoad/total to withAsync.
        if (restoreSnapshot && restoreSnapshot.total && restoreSnapshot.total > 0) {
          const cancelAutoLoad = ctx.methods.get("_cancelAutoLoad") as
            | (() => void)
            | undefined;
          if (cancelAutoLoad) cancelAutoLoad();

          // Bootstrap total so sizeCache/compression are ready for restore
          ctx.dataManager.setTotal(restoreSnapshot.total);
        }
      }

      // ── Auto-restore ──
      // If a restore snapshot was provided via config (or read from
      // sessionStorage by autoSave), schedule restoration via
      // queueMicrotask. This runs right after build() returns (all
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