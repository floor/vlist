/**
 * vlist v2 — Snapshots Plugin
 *
 * Scroll save/restore for SPA navigation and tab switching.
 * Captures the first visible item index + sub-pixel offset,
 * surviving list recreation and compression mode changes.
 *
 * Priority: 50 (runs late — needs other plugins initialized)
 */

import type { VListItem, ScrollSnapshot } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

// =============================================================================
// Config
// =============================================================================

export interface SnapshotsPluginConfig {
  restore?: ScrollSnapshot;
  autoSave?: string;
}

// =============================================================================
// Helpers
// =============================================================================

const readSnapshot = (key: string): ScrollSnapshot | undefined => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as ScrollSnapshot;
  } catch {
    return undefined;
  }
};

// =============================================================================
// Factory
// =============================================================================

export function snapshots<T extends VListItem = VListItem>(
  config?: SnapshotsPluginConfig,
): VListPlugin<T> {
  const autoSaveKey = config?.autoSave;

  const restoreSnapshot = autoSaveKey
    ? readSnapshot(autoSaveKey)
    : config?.restore;

  let disposed = false;
  let saveToStorage: (() => void) | null = null;

  return {
    name: "snapshots",
    priority: 50,

    setup(ctx: PluginContext<T>): void {
      const { sizeCache, emitter } = ctx;
      const state = ctx.getState();

      // ── getScrollSnapshot ──────────────────────────────────────

      const getScrollSnapshot = (): ScrollSnapshot => {
        const scrollTop = state.scrollPosition;
        const totalItems = state.totalItems;

        const getSelected = ctx.getMethod("getSelected") as
          | (() => Array<string | number>)
          | undefined;
        const selectedIds = getSelected?.();

        if (totalItems === 0) {
          const snap: ScrollSnapshot = { index: 0, offsetInItem: 0, total: 0 };
          if (selectedIds?.length) snap.selectedIds = selectedIds;
          return snap;
        }

        let index: number;
        let offsetInItem: number;

        if (state.isCompressed && state.compressionRatio !== 1) {
          const virtualSize = state.totalSize;
          const scrollRatio = scrollTop / virtualSize;
          const exactIndex = scrollRatio * totalItems;
          index = Math.max(0, Math.min(Math.floor(exactIndex), totalItems - 1));
          const fraction = exactIndex - index;
          offsetInItem = fraction * sizeCache.getSize(index);
        } else {
          index = sizeCache.indexAtOffset(scrollTop);
          offsetInItem = scrollTop - sizeCache.getOffset(index);
        }

        offsetInItem = Math.max(0, offsetInItem);

        const snap: ScrollSnapshot = {
          index,
          offsetInItem,
          total: totalItems,
          scrollTop,
        };

        const itemSize = sizeCache.getSize(index);
        if (itemSize) snap.offsetRatio = offsetInItem / itemSize;

        const layoutToData = ctx.getMethod("_layoutToDataIndex") as
          | ((layoutIndex: number) => number)
          | undefined;
        if (layoutToData) {
          let di = layoutToData(index);
          if (di < 0) {
            for (let i = index + 1; i < totalItems; i++) {
              di = layoutToData(i);
              if (di >= 0) break;
            }
          }
          if (di >= 0) snap.dataIndex = di;
        }

        const getDataTotal = ctx.getMethod("_getTotal") as
          | (() => number)
          | undefined;
        if (getDataTotal) snap.dataTotal = getDataTotal();

        if (selectedIds?.length) snap.selectedIds = selectedIds;

        const getFocusedId = ctx.getMethod("_getFocusedId") as
          | (() => string | number | undefined)
          | undefined;
        if (getFocusedId) {
          const focusedId = getFocusedId();
          if (focusedId !== undefined) snap.focusedId = focusedId;
        }

        return snap;
      };

      ctx.registerMethod("getScrollSnapshot", getScrollSnapshot);

      // ── restoreScroll ──────────────────────────────────────────

      const restoreScroll = (snapshot: ScrollSnapshot, restoreSelection = true): void => {
        const { index, offsetInItem, selectedIds, focusedId } = snapshot;
        let effectiveTotal = state.totalItems;

        const bootstrapTotal = snapshot.dataTotal ?? snapshot.total;
        if (effectiveTotal === 0 && bootstrapTotal && bootstrapTotal > 0) {
          const setTotal = ctx.getMethod("_setTotal") as
            | ((total: number) => void)
            | undefined;
          if (setTotal) {
            setTotal(bootstrapTotal);
            effectiveTotal = state.totalItems;
          }

          sizeCache.rebuild(effectiveTotal);

          const updateCompression = ctx.getMethod("_updateCompressionMode") as
            | (() => void)
            | undefined;
          if (updateCompression) updateCompression();

          if (!state.isCompressed) {
            ctx.updateContentSize(sizeCache.getTotalSize());
            state.totalSize = sizeCache.getTotalSize();
          }
        }

        if (effectiveTotal === 0) return;
        if (!Number.isFinite(index) || !Number.isFinite(offsetInItem)) return;

        // Only rebuild if the cache is empty — a non-zero total that differs
        // from state.totalItems means a layout plugin (grid/masonry) manages
        // the cache in row/lane space and we must not overwrite it.
        const sizeCacheTotal = sizeCache.getTotal();
        if (sizeCacheTotal === 0) {
          sizeCache.rebuild(effectiveTotal);
          const updateCompression = ctx.getMethod("_updateCompressionMode") as
            | (() => void)
            | undefined;
          if (updateCompression) updateCompression();
          if (!state.isCompressed) {
            ctx.updateContentSize(sizeCache.getTotalSize());
            state.totalSize = sizeCache.getTotalSize();
          }
        }

        const dataToLayout = ctx.getMethod("_dataToLayoutIndex") as
          | ((dataIndex: number) => number)
          | undefined;
        let resolvedIndex = index;
        if (snapshot.dataIndex !== undefined && snapshot.dataIndex >= 0) {
          resolvedIndex = dataToLayout
            ? dataToLayout(snapshot.dataIndex)
            : snapshot.dataIndex;
        } else if (dataToLayout) {
          resolvedIndex = dataToLayout(index);
        }

        const safeIndex = Math.max(0, Math.min(resolvedIndex, effectiveTotal - 1));

        const currentItemSize = sizeCache.getSize(safeIndex);
        const resolvedOffset = snapshot.offsetRatio !== undefined
          ? snapshot.offsetRatio * currentItemSize
          : Math.min(offsetInItem, currentItemSize);

        let scrollPosition: number;

        if (state.isCompressed && state.compressionRatio !== 1) {
          const currentDataTotal = (ctx.getMethod("_getTotal") as (() => number) | undefined)?.();
          const dataTotalMatch = currentDataTotal !== undefined
            && snapshot.dataTotal === currentDataTotal;
          if (snapshot.scrollTop !== undefined && (snapshot.total === effectiveTotal || dataTotalMatch)) {
            scrollPosition = snapshot.scrollTop;
          } else {
            const fraction = currentItemSize ? resolvedOffset / currentItemSize : 0;
            scrollPosition =
              ((safeIndex + fraction) / effectiveTotal) * state.totalSize;
          }
        } else {
          scrollPosition = sizeCache.getOffset(safeIndex) + resolvedOffset;
        }

        const maxScroll = Math.max(0, state.totalSize - state.containerSize);
        scrollPosition = Math.max(0, Math.min(scrollPosition, maxScroll));

        const usedShortcut = scrollPosition === snapshot.scrollTop;
        if (snapshot.dataIndex !== undefined && snapshot.dataIndex >= 0) {
          const fraction = currentItemSize ? resolvedOffset / currentItemSize : 0;
          ctx.registerMethod("_restoreAnchor", {
            dataIndex: snapshot.dataIndex,
            fraction,
            skipAdjust: usedShortcut,
          } as unknown as Function);
          ctx.registerMethod("_suppressSave", 1 as unknown as Function);
        }

        ctx.scrollTo(scrollPosition);

        if (restoreSelection && selectedIds?.length) {
          const selectFn = ctx.getMethod("select") as
            | ((...ids: Array<string | number>) => void)
            | undefined;
          if (selectFn) selectFn(...selectedIds);
        }

        const loadVisibleFn = ctx.getMethod("loadVisibleRange") as
          | (() => Promise<void>)
          | undefined;

        const restoreFocus = (): void => {
          if (focusedId === undefined) return;
          const focusByIdFn = ctx.getMethod("_focusById") as
            | ((id: string | number) => void)
            | undefined;
          if (focusByIdFn) focusByIdFn(focusedId);
        };

        if (loadVisibleFn) {
          let polls = 0;
          const pollUntilReady = (): void => {
            if (state.containerSize > 0) {
              if (Math.abs(state.scrollPosition - scrollPosition) > 1) {
                ctx.scrollTo(scrollPosition);
              }
              loadVisibleFn().then(restoreFocus);
            } else if (++polls < 10) {
              requestAnimationFrame(pollUntilReady);
            }
          };
          requestAnimationFrame(pollUntilReady);
        } else {
          const reloadFn = ctx.getMethod("reload") as
            | (() => Promise<void>)
            | undefined;
          if (reloadFn) {
            requestAnimationFrame(() => { reloadFn().then(restoreFocus); });
          } else {
            requestAnimationFrame(restoreFocus);
          }
        }
      };

      ctx.registerMethod("restoreScroll", restoreScroll);

      // ── Auto-save ──────────────────────────────────────────────

      let restoreGuard = !!(restoreSnapshot && autoSaveKey);

      ctx.registerDestroyHandler(() => { disposed = true; });

      if (autoSaveKey) {
        saveToStorage = (): void => {
          if (disposed || restoreGuard || ctx.getMethod("_suppressSave")) return;
          const snap = getScrollSnapshot();
          try {
            sessionStorage.setItem(autoSaveKey, JSON.stringify(snap));
          } catch { /* sessionStorage full or unavailable */ }
        };

        ctx.registerMethod("_saveSnapshot", saveToStorage);

        let saveTimer = 0;
        const debouncedSave = (): void => {
          if (saveTimer) return;
          saveTimer = requestAnimationFrame(() => {
            saveTimer = 0;
            if (saveToStorage) saveToStorage();
          }) as unknown as number;
        };

        emitter.on("selection:change", debouncedSave);
        emitter.on("focus:change", debouncedSave);

        let scrollSaveTimer = 0;
        const scrollSaveCallback = (): void => {
          scrollSaveTimer = 0;
          if (saveToStorage) saveToStorage();
        };
        const debouncedScrollSave = (): void => {
          if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
          scrollSaveTimer = setTimeout(scrollSaveCallback, 300) as unknown as number;
        };

        emitter.on("scroll", debouncedScrollSave);

        const onBeforeUnload = (): void => { saveToStorage?.(); };
        window.addEventListener("beforeunload", onBeforeUnload);

        ctx.registerDestroyHandler(() => {
          if (saveTimer) cancelAnimationFrame(saveTimer);
          if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
          window.removeEventListener("beforeunload", onBeforeUnload);
        });

        if (restoreSnapshot && restoreSnapshot.total && restoreSnapshot.total > 0) {
          const cancelAutoLoad = ctx.getMethod("_cancelAutoLoad") as
            | (() => void)
            | undefined;
          if (cancelAutoLoad) cancelAutoLoad();

          const setTotal = ctx.getMethod("_setTotal") as
            | ((total: number) => void)
            | undefined;
          if (setTotal) setTotal(restoreSnapshot.total);
        }
      }

      // ── Auto-restore ───────────────────────────────────────────

      if (restoreSnapshot) {
        let restoreSelection = true;
        if (restoreSnapshot.selectedIds?.length) {
          const seedFn = ctx.getMethod("_seedSelection") as
            | ((ids: Array<string | number>) => void)
            | undefined;
          if (seedFn) {
            seedFn(restoreSnapshot.selectedIds);
            restoreSelection = false;
          }
        }

        queueMicrotask(() => {
          restoreScroll(restoreSnapshot, restoreSelection);
          restoreGuard = false;
          if (saveToStorage) saveToStorage();
        });
      }
    },

    hooks: {
      onIdle(): void {
        if (saveToStorage && !disposed) saveToStorage();
      },
    },

    destroy(): void {
      disposed = true;
      saveToStorage = null;
    },
  };
}
