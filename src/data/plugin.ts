/**
 * vlist/data - Builder Plugin
 * Wraps async data loading with sparse storage into a VListPlugin for the composable builder.
 *
 * Priority: 20 (runs before scrollbar and selection, after grid/groups)
 *
 * What it wires:
 * - Replaces data manager — swaps the simple in-memory store with sparse storage
 * - Scroll boundary detection — triggers loadMore() near the bottom (or top in reverse)
 * - Velocity-aware loading — skips data fetching during fast scrolling, loads on idle
 * - Placeholder generation — creates skeleton items for unloaded ranges
 * - Request deduplication — prevents duplicate fetches for the same range
 * - Idle handler — loads any pending ranges when scrolling stops
 *
 * Added methods: reload
 * Added events: load:start, load:end, error
 */

import type { VListItem, VListAdapter, Range } from "../types";
import type { VListPlugin, BuilderContext } from "../builder/types";

import { createDataManager, type DataManagerConfig } from "./manager";
import { updateViewportItems } from "../render";

import {
  INITIAL_LOAD_SIZE,
  LOAD_MORE_THRESHOLD,
  CANCEL_LOAD_VELOCITY_THRESHOLD,
  PRELOAD_VELOCITY_THRESHOLD,
  PRELOAD_ITEMS_AHEAD,
} from "../constants";

// =============================================================================
// Plugin Config
// =============================================================================

/** Data plugin configuration */
export interface DataPluginConfig<T extends VListItem = VListItem> {
  /** Async data source (required) */
  adapter: VListAdapter<T>;

  /** Loading behavior configuration */
  loading?: {
    /** Velocity threshold above which data loading is skipped (px/ms). Default: 25 */
    cancelThreshold?: number;

    /** Velocity threshold for preloading (px/ms). Default: 2 */
    preloadThreshold?: number;

    /** Number of items to preload in scroll direction. Default: 50 */
    preloadAhead?: number;
  };
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a data plugin for the builder.
 *
 * Adds async data loading with sparse storage, placeholders, and infinite scroll.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withData } from 'vlist/data'
 *
 * const list = vlist({
 *   container: '#app',
 *   item: { height: 48, template: renderItem },
 * })
 * .use(withData({
 *   adapter: {
 *     read: async ({ offset, limit }) => {
 *       const res = await fetch(`/api/items?offset=${offset}&limit=${limit}`)
 *       const data = await res.json()
 *       return { items: data.items, total: data.total, hasMore: data.hasMore }
 *     }
 *   }
 * }))
 * .build()
 * ```
 */
export const withData = <T extends VListItem = VListItem>(
  config: DataPluginConfig<T>,
): VListPlugin<T> => {
  const { adapter, loading } = config;
  const cancelLoadThreshold =
    loading?.cancelThreshold ?? CANCEL_LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loading?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loading?.preloadAhead ?? PRELOAD_ITEMS_AHEAD;

  return {
    name: "withData",
    priority: 20,

    methods: ["reload"] as const,

    setup(ctx: BuilderContext<T>): void {
      const { emitter } = ctx;
      const isReverse = ctx.config.reverse;
      const overscan = ctx.config.overscan;

      // ── Create adapter-backed data manager ──
      const newDataManager = createDataManager<T>({
        adapter,
        pageSize: INITIAL_LOAD_SIZE,
        onStateChange: () => {
          if (ctx.state.isInitialized) {
            ctx.heightCache.rebuild(ctx.getVirtualTotal());
            ctx.updateCompressionMode();
            ctx.state.viewportState = updateViewportItems(
              ctx.state.viewportState,
              ctx.heightCache,
              ctx.getVirtualTotal(),
              overscan,
              ctx.getCachedCompression(),
            );
            ctx.updateContentSize(ctx.state.viewportState.totalHeight);
            ctx.renderIfNeeded();
          }
        },
        onItemsLoaded: (loadedItems, _offset, total) => {
          if (ctx.state.isInitialized) {
            ctx.heightCache.rebuild(ctx.getVirtualTotal());
            ctx.forceRender();
            emitter.emit("load:end", { items: loadedItems, total });
          }
        },
      });

      // Replace the core's basic data manager with the adapter-backed one
      ctx.replaceDataManager(newDataManager);

      // ── Velocity-aware scroll loading state ──
      let lastEnsuredRange: Range | null = null;
      let pendingRange: Range | null = null;
      let previousVelocity = 0;

      /**
       * Load the pending range if any (called on idle)
       */
      const loadPendingRange = (): void => {
        if (pendingRange) {
          const range = pendingRange;
          pendingRange = null;

          ctx.dataManager.ensureRange(range.start, range.end).catch((error) => {
            emitter.emit("error", { error, context: "ensureRange" });
          });
        }
      };

      // ── Post-scroll: velocity-aware loading + load-more ──
      ctx.afterScroll.push((scrollTop: number, direction: string): void => {
        if (ctx.state.isDestroyed) return;

        const currentVelocity = ctx.scrollController.getVelocity();
        const velocityReliable = ctx.scrollController.isTracking();

        // Only allow loading when velocity tracker is reliable and below threshold
        const canLoad =
          velocityReliable && currentVelocity <= cancelLoadThreshold;

        // Check if velocity just dropped below threshold — load pending range immediately
        if (
          pendingRange &&
          previousVelocity > cancelLoadThreshold &&
          currentVelocity <= cancelLoadThreshold
        ) {
          const range = pendingRange;
          pendingRange = null;
          ctx.dataManager.ensureRange(range.start, range.end).catch((error) => {
            emitter.emit("error", { error, context: "ensureRange" });
          });
        }

        previousVelocity = currentVelocity;

        // ── Check for infinite scroll (load more) ──
        if (
          canLoad &&
          !ctx.dataManager.getIsLoading() &&
          ctx.dataManager.getHasMore()
        ) {
          if (isReverse) {
            // Reverse mode: trigger "load more" near the TOP
            if (scrollTop < LOAD_MORE_THRESHOLD) {
              emitter.emit("load:start", {
                offset: ctx.dataManager.getCached(),
                limit: INITIAL_LOAD_SIZE,
              });

              ctx.dataManager.loadMore().catch((error) => {
                emitter.emit("error", { error, context: "loadMore" });
              });
            }
          } else {
            // Normal mode: trigger "load more" near the BOTTOM
            const distanceFromBottom =
              ctx.state.viewportState.totalHeight -
              scrollTop -
              ctx.state.viewportState.containerHeight;

            if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
              emitter.emit("load:start", {
                offset: ctx.dataManager.getCached(),
                limit: INITIAL_LOAD_SIZE,
              });

              ctx.dataManager.loadMore().catch((error) => {
                emitter.emit("error", { error, context: "loadMore" });
              });
            }
          }
        }

        // ── Ensure visible range is loaded (sparse data) ──
        const { renderRange } = ctx.state.viewportState;
        const rangeChanged =
          !lastEnsuredRange ||
          renderRange.start !== lastEnsuredRange.start ||
          renderRange.end !== lastEnsuredRange.end;

        if (rangeChanged) {
          lastEnsuredRange = {
            start: renderRange.start,
            end: renderRange.end,
          };

          if (canLoad) {
            pendingRange = null;

            // Calculate preload range based on scroll direction and velocity
            let loadStart = renderRange.start;
            let loadEnd = renderRange.end;
            const total = ctx.getVirtualTotal();

            if (currentVelocity > preloadThreshold) {
              if (direction === "down") {
                loadEnd = Math.min(renderRange.end + preloadAhead, total - 1);
              } else {
                loadStart = Math.max(renderRange.start - preloadAhead, 0);
              }
            }

            ctx.dataManager.ensureRange(loadStart, loadEnd).catch((error) => {
              emitter.emit("error", { error, context: "ensureRange" });
            });
          } else {
            // Scrolling too fast — save range for loading when idle
            pendingRange = {
              start: renderRange.start,
              end: renderRange.end,
            };
          }
        }
      });

      // ── Idle detection for pending ranges ──
      // The scroll controller's onIdle was wired at creation time (in builder
      // core) and can't be patched via updateConfig. Instead, we detect idle
      // ourselves using a simple timer in the afterScroll callback. When no
      // scroll event fires for `idleMs`, we consider the scroll idle and load
      // any pending range.
      const idleMs = 200; // slightly longer than scroll controller's default 150ms
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      // We push a second afterScroll callback that manages the idle timer.
      // The first afterScroll (pushed above) handles per-frame loading logic.
      ctx.afterScroll.push((_scrollTop: number, _direction: string): void => {
        // Reset idle timer on every scroll frame
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          idleTimer = null;
          loadPendingRange();
        }, idleMs);
      });

      // Clean up idle timer on destroy
      ctx.destroyHandlers.push(() => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      });

      // ── ARIA: aria-busy for loading state ──
      emitter.on("load:start", () => {
        ctx.dom.root.setAttribute("aria-busy", "true");
      });
      emitter.on("load:end", () => {
        ctx.dom.root.removeAttribute("aria-busy");
      });

      // ── Register reload method ──
      ctx.methods.set("reload", async (): Promise<void> => {
        await ctx.dataManager.reload();
      });

      // ── Load initial data ──
      emitter.emit("load:start", { offset: 0, limit: INITIAL_LOAD_SIZE });
      ctx.dataManager.loadInitial().catch((error) => {
        emitter.emit("error", { error, context: "loadInitial" });
      });
    },
  };
};
