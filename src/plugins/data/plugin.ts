/**
 * vlist v2 — Async Plugin
 *
 * Enables async data loading with sparse storage, placeholders, and infinite scroll.
 * Priority 20 — runs before scrollbar and selection, after layout plugins.
 *
 * Features:
 * - Replaces default data source with async adapter-backed storage
 * - Lazy-loads data in chunks on scroll + idle detection
 * - Shows placeholders for unloaded items
 * - Deduplicates concurrent fetch requests
 * - Velocity-aware loading: skips loads during fast scrolling, loads on idle
 * - Infinite scroll: loads next page when scrolling near bottom
 * - Public methods: reload(), loadVisibleRange()
 * - Emits: load:start, load:end, error events
 */

import type { VListItem, VListAdapter } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { SizeCache } from "../../core/sizes";

import { createDataManager, type DataManager } from "./manager";

import {
  INITIAL_LOAD_SIZE,
  LOAD_VELOCITY_THRESHOLD,
  PRELOAD_VELOCITY_THRESHOLD,
  PRELOAD_AHEAD,
  MAX_CONCURRENT_LOADS,
} from "../../constants";

// =============================================================================
// Config
// =============================================================================

export interface DataPluginConfig<T extends VListItem = VListItem> {
  /** Async data source (required) */
  adapter: VListAdapter<T>;

  /** Total number of items (optional - if not provided, adapter must return it) */
  total?: number;

  /** Whether to automatically load initial data (default: true) */
  autoLoad?: boolean;

  /** Storage configuration */
  storage?: {
    /** Number of items per chunk (default: 100) */
    chunkSize?: number;

    /** Maximum cached items before eviction (default: 10000) */
    maxCachedItems?: number;

    /** Extra items to keep around visible range (default: 500) */
    evictionBuffer?: number;
  };

  /** Loading behavior configuration */
  loading?: {
    /** Velocity threshold above which data loading is cancelled (px/ms) */
    cancelThreshold?: number;

    /** Velocity threshold for preloading (px/ms) */
    preloadThreshold?: number;

    /** Number of items to preload in scroll direction */
    preloadAhead?: number;

    /** Maximum concurrent chunk requests (0 = unlimited, default: 6) */
    maxConcurrent?: number;
  };
}

// =============================================================================
// Factory
// =============================================================================

export function data<T extends VListItem = VListItem>(
  config: DataPluginConfig<T>,
): VListPlugin<T> {
  const { adapter, total, autoLoad = true, storage } = config;

  const cancelThreshold = config.loading?.cancelThreshold ?? LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold = config.loading?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = config.loading?.preloadAhead ?? PRELOAD_AHEAD;
  const maxConcurrent = config.loading?.maxConcurrent ?? MAX_CONCURRENT_LOADS;

  let dataManager: DataManager<T>;
  let engineState: EngineState;
  let sizeCache: SizeCache;
  let emitter: PluginContext<T>["emitter"];
  let dom: PluginContext<T>["dom"];
  let forceRender: () => void;

  let pendingRange: { start: number; end: number } | null = null;
  let decelerationTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let currentVelocity = 0;
  let autoLoadCancelled = false;

  // Track last requested chunk range to skip redundant ensure() calls
  let lastFirstChunk = -1;
  let lastLastChunk = -1;
  const chunkSize = storage?.chunkSize ?? INITIAL_LOAD_SIZE;

  // ============================================================================
  // Helpers
  // ============================================================================

  const resetDeceleration = (): void => {
    pendingRange = null;
    if (decelerationTimer !== null) {
      clearTimeout(decelerationTimer);
      decelerationTimer = null;
    }
  };

  const ensure = (start: number, end: number): Promise<void> => {
    return dataManager.ensureRange(start, end);
  };

  const emitLoadStart = (offset: number, limit: number = INITIAL_LOAD_SIZE): void => {
    emitter.emit("load:start", { offset, limit });
  };

  const onEnsureError = (error: Error): void => {
    emitter.emit("error", { error, context: "ensureRange" });
  };

  const loadPendingRange = (): void => {
    if (!pendingRange) {
      return;
    }
    pendingRange = null;

    const currentRange = {
      start: engineState.startIndex,
      end: engineState.startIndex + Math.max(0, engineState.visibleCount - 1),
    };

    if (currentRange.end < currentRange.start) {
      return;
    }

    ensure(currentRange.start, currentRange.end).catch(onEnsureError);
  };

  // ============================================================================
  // Plugin Definition
  // ============================================================================

  return {
    name: "data",
    priority: 20,

    setup(ctx: PluginContext<T>): void {
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      emitter = ctx.emitter;
      dom = ctx.dom;
      forceRender = ctx.forceRender.bind(ctx);

      // Create data manager — but first wire up virtualTotalFn
      // so scrollToIndex and api.total reflect the async data total
      let dataManagerRef: DataManager<T> | null = null;
      ctx.setVirtualTotalFn(() => dataManagerRef?.getTotal() ?? 0);

      dataManager = dataManagerRef = createDataManager({
        adapter,
        ...(total !== undefined && { initialTotal: total }),
        pageSize: storage?.chunkSize ?? INITIAL_LOAD_SIZE,
        maxConcurrent,
        ...(storage && {
          storage: {
            ...(storage.chunkSize !== undefined && { chunkSize: storage.chunkSize }),
            ...(storage.maxCachedItems !== undefined && { maxCachedItems: storage.maxCachedItems }),
            ...(storage.evictionBuffer !== undefined && { evictionBuffer: storage.evictionBuffer }),
          },
        }),
        onDataChange: () => {
          if (engineState.initialized) {
            const newTotal = dataManager.getTotal();
            engineState.totalItems = newTotal;
            const oldTotal = sizeCache.getTotal();
            if (newTotal !== oldTotal) {
              sizeCache.rebuild(newTotal);
            }
            ctx.updateContentSize(sizeCache.getTotalSize());
            ctx.renderIfNeeded();
          }
        },
        onItemsLoaded: (loadedItems) => {
          if (engineState.initialized) {
            // Always rebuild sizeCache so layout interceptors (groups plugin)
            // can detect newly loaded items and rebuild their layout.
            sizeCache.rebuild(dataManager.getTotal());
            ctx.updateContentSize(sizeCache.getTotalSize());
            forceRender();
            emitter.emit("load:end", { items: loadedItems, total: dataManager.getTotal() });
          }
        },
      });

      // Bridge async data manager to the render pipeline
      ctx.setGetItemFn((index: number) => dataManager.getItem(index) as T | undefined);

      ctx.setRemoveItemFn((id: string | number): number => {
        const index = dataManager.getIndexById(id);
        if (index < 0) return -1;
        const removed = dataManager.removeItem(id);
        if (!removed) return -1;
        return index;
      });

      ctx.setInsertItemFn((item: T, index: number): void => {
        dataManager.insertItem(item, index);
      });

      ctx.setUpdateItemFn((id: string | number, updates: Partial<T>): boolean => {
        const index = dataManager.getIndexById(id);
        if (index < 0) return false;
        return dataManager.updateItem(index, updates);
      });

      // Register public methods
      ctx.registerMethod("reload", async (): Promise<void> => {
        pendingRange = null;
        lastFirstChunk = -1;
        lastLastChunk = -1;

        ctx.forceRender();

        await dataManager.reload();
        ctx.scrollTo(0);

        if (autoLoad) {
          emitLoadStart(0);
          await dataManager.loadInitial();
          ctx.forceRender();
        }
      });

      ctx.registerMethod("loadVisibleRange", async (): Promise<void> => {
        pendingRange = null;

        ctx.forceRender();

        const total = dataManager.getTotal();
        if (engineState.visibleCount > 0 && engineState.startIndex < total) {
          const end = Math.min(
            engineState.startIndex + engineState.visibleCount - 1,
            total - 1,
          );
          emitLoadStart(engineState.startIndex, end - engineState.startIndex + 1);
          await ensure(engineState.startIndex, end);
        }
      });

      // Load the first page deterministically, independent of container
      // dimensions. Use when you need data loaded from the top regardless of
      // layout state (e.g. an explicit reload before the viewport is measured);
      // loadVisibleRange is a no-op until the container has a measured height.
      ctx.registerMethod("loadInitial", async (): Promise<void> => {
        emitLoadStart(0);
        await dataManager.loadInitial();
        ctx.forceRender();
      });

      ctx.registerMethod("getTotal", (): number => {
        return dataManager.getTotal();
      });

      ctx.registerMethod("setTotal", (total: number): void => {
        dataManager.setTotal(total);
      });

      ctx.registerMethod("_getTotal", (): number => dataManager.getTotal());

      ctx.registerMethod("_setTotal", (t: number): void => {
        dataManager.setTotal(t);
      });

      ctx.registerMethod("_cancelAutoLoad", (): void => {
        autoLoadCancelled = true;
      });

      ctx.registerMethod("_getLoadedItem", (index: number): T | undefined => {
        return dataManager.getStorage().get(index) as T | undefined;
      });

      ctx.registerMethod("_getItem", (index: number): T | undefined => {
        return dataManager.getItem(index) as T | undefined;
      });

      ctx.registerMethod("_getLoadedCount", (): number => dataManager.getCached());

      // ARIA: aria-busy for loading state
      emitter.on("load:start", () => {
        dom.root.setAttribute("aria-busy", "true");
      });
      emitter.on("load:end", () => {
        dom.root.removeAttribute("aria-busy");
      });

      ctx.registerDestroyHandler(() => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        resetDeceleration();
      });

      // Track velocity for load gating
      emitter.on("velocity:change", ({ velocity }: { velocity: number }) => {
        currentVelocity = Math.abs(velocity);
      });

      // Network recovery
      const handleOnline = (): void => {
        if (engineState.destroyed) return;

        if (engineState.visibleCount > 0 && engineState.startIndex < dataManager.getTotal()) {
          const end = Math.min(
            engineState.startIndex + engineState.visibleCount - 1,
            dataManager.getTotal() - 1,
          );
          ensure(engineState.startIndex, end).catch(onEnsureError);
        }

        loadPendingRange();
      };

      window.addEventListener("online", handleOnline);

      ctx.registerDestroyHandler(() => {
        window.removeEventListener("online", handleOnline);
      });

      // Load initial data (if autoLoad is enabled)
      if (autoLoad) {
        queueMicrotask(() => {
          if (autoLoadCancelled) return;
          emitLoadStart(0);
          dataManager.loadInitial().catch((error) => {
            emitter.emit("error", { error, context: "loadInitial" });
          });
        });
      } else if (total !== undefined) {
        dataManager.setTotal(total);
      }
    },

    hooks: {
      onAfterScroll(): void {
        if (engineState.destroyed) return;

        const visEnd = engineState.startIndex + Math.max(0, engineState.visibleCount - 1);

        // Fast scrolling (above cancelThreshold): skip loading, defer to idle
        if (currentVelocity > cancelThreshold) {
          if (decelerationTimer !== null) {
            clearTimeout(decelerationTimer);
            decelerationTimer = null;
          }
          pendingRange = { start: engineState.startIndex, end: visEnd };
          return;
        }

        // Moderate scrolling (between preloadThreshold and cancelThreshold):
        // load visible range immediately, debounce preload-ahead only
        if (currentVelocity > preloadThreshold) {
          const fc = Math.floor(engineState.startIndex / chunkSize);
          const lc = Math.floor(visEnd / chunkSize);
          if (fc !== lastFirstChunk || lc !== lastLastChunk) {
            lastFirstChunk = fc;
            lastLastChunk = lc;
            if (visEnd >= engineState.startIndex) {
              ensure(engineState.startIndex, visEnd).catch(onEnsureError);
            }
          }

          let loadStart = engineState.startIndex;
          let loadEnd = visEnd;
          const dir = engineState.scrollDirection;
          if (dir > 0) {
            loadEnd = Math.min(loadEnd + preloadAhead, dataManager.getTotal() - 1);
          } else if (dir < 0) {
            loadStart = Math.max(0, loadStart - preloadAhead);
          }

          pendingRange = { start: loadStart, end: loadEnd };

          if (decelerationTimer !== null) {
            clearTimeout(decelerationTimer);
          }
          decelerationTimer = setTimeout(() => {
            decelerationTimer = null;
            if (engineState.destroyed || !pendingRange) return;
            const { start, end } = pendingRange;
            pendingRange = null;
            if (end >= start) {
              ensure(start, end).catch(onEnsureError);
            }
          }, 100);
          return;
        }

        // Slow scrolling (below preloadThreshold): load visible range immediately
        resetDeceleration();
        const fc = Math.floor(engineState.startIndex / chunkSize);
        const lc = Math.floor(visEnd / chunkSize);
        if (fc !== lastFirstChunk || lc !== lastLastChunk) {
          lastFirstChunk = fc;
          lastLastChunk = lc;
          if (visEnd >= engineState.startIndex) {
            ensure(engineState.startIndex, visEnd).catch(onEnsureError);
          }
        }
      },

      onIdle(): void {
        if (engineState.destroyed) return;

        currentVelocity = 0;
        lastFirstChunk = -1;
        lastLastChunk = -1;
        loadPendingRange();
        resetDeceleration();
      },

      onResize(): void {
        if (engineState.destroyed) return;

        // A resize changes the visible window — like a scroll. When the
        // container gains dimensions (e.g. first layout after mount) and a
        // total is already declared, ensure the now-visible range loads.
        // ensure() dedupes against cached/in-flight chunks, so this is a
        // no-op when the range is already loading or loaded.
        const total = dataManager.getTotal();
        if (total <= 0) return;
        if (engineState.visibleCount <= 0 || engineState.startIndex >= total) return;

        const end = Math.min(
          engineState.startIndex + engineState.visibleCount - 1,
          total - 1,
        );
        if (end < engineState.startIndex) return;
        emitLoadStart(engineState.startIndex, end - engineState.startIndex + 1);
        ensure(engineState.startIndex, end).catch(onEnsureError);
      },
    },

    destroy(): void {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      resetDeceleration();
    },
  };
}