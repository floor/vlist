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
} from "../../constants";

// =============================================================================
// Config
// =============================================================================

export interface AsyncPluginConfig<T extends VListItem = VListItem> {
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
  };
}

// =============================================================================
// Factory
// =============================================================================

export function async<T extends VListItem = VListItem>(
  config: AsyncPluginConfig<T>,
): VListPlugin<T> {
  const { adapter, total, autoLoad = true, storage } = config;

  let dataManager: DataManager<T>;
  let engineState: EngineState;
  let sizeCache: SizeCache;
  let emitter: PluginContext<T>["emitter"];
  let dom: PluginContext<T>["dom"];
  let forceRender: () => void;

  let pendingRange: { start: number; end: number } | null = null;
  let decelerationTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
    name: "async",
    priority: 20,

    setup(ctx: PluginContext<T>): void {
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      emitter = ctx.emitter;
      dom = ctx.dom;
      forceRender = ctx.forceRender.bind(ctx);

      // Create data manager
      dataManager = createDataManager({
        adapter,
        ...(total !== undefined && { initialTotal: total }),
        pageSize: storage?.chunkSize ?? INITIAL_LOAD_SIZE,
        ...(storage && {
          storage: {
            ...(storage.chunkSize !== undefined && { chunkSize: storage.chunkSize }),
            ...(storage.maxCachedItems !== undefined && { maxCachedItems: storage.maxCachedItems }),
            ...(storage.evictionBuffer !== undefined && { evictionBuffer: storage.evictionBuffer }),
          },
        }),
        onStateChange: () => {
          if (engineState.initialized) {
            const newTotal = dataManager.getTotal();
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
            forceRender();
            emitter.emit("load:end", { items: loadedItems, total: dataManager.getTotal() });
          }
        },
      });

      // Register public methods
      ctx.registerMethod("reload", async (): Promise<void> => {
        pendingRange = null;

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

      ctx.registerMethod("getTotal", (): number => {
        return dataManager.getTotal();
      });

      ctx.registerMethod("setTotal", (total: number): void => {
        dataManager.setTotal(total);
      });

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
      onIdle(): void {
        if (engineState.destroyed) return;

        loadPendingRange();
        resetDeceleration();
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