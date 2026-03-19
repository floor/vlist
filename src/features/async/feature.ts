/**
 * vlist/data - Builder Feature
 * Wraps async data loading with sparse storage into a VListFeature for the composable builder.
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

import type { VListItem, VListAdapter, Range } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

import { createDataManager } from "./manager";

import {
  INITIAL_LOAD_SIZE,
  LOAD_THRESHOLD,
  LOAD_VELOCITY_THRESHOLD,
  PRELOAD_VELOCITY_THRESHOLD,
  PRELOAD_AHEAD,
} from "../../constants";

// =============================================================================
// Feature Config
// =============================================================================

/** Data feature configuration */
export interface DataFeatureConfig<T extends VListItem = VListItem> {
  /** Async data source (required) */
  adapter: VListAdapter<T>;

  /** Total number of items (optional - if not provided, adapter must return it) */
  total?: number;

  /** Whether to automatically load initial data. Default: true */
  autoLoad?: boolean;

  /** Storage configuration */
  storage?: {
    /** Number of items per chunk. Default: 100 */
    chunkSize?: number;

    /** Maximum cached items before eviction. Default: 10000 */
    maxCachedItems?: number;
  };

  /** Loading behavior configuration */
  loading?: {
    /** Velocity threshold above which data loading is skipped (px/ms). Default: 5 */
    cancelThreshold?: number;

    /** Velocity threshold for preloading (px/ms). Default: 2 */
    preloadThreshold?: number;

    /** Number of items to preload in scroll direction. Default: 50 */
    preloadAhead?: number;
  };
}

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a data feature for the builder.
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
export const withAsync = <T extends VListItem = VListItem>(
  config: DataFeatureConfig<T>,
): VListFeature<T> => {
  const { adapter, loading, storage, total, autoLoad = true } = config;
  const cancelLoadThreshold =
    loading?.cancelThreshold ?? LOAD_VELOCITY_THRESHOLD;
  const preloadThreshold =
    loading?.preloadThreshold ?? PRELOAD_VELOCITY_THRESHOLD;
  const preloadAhead = loading?.preloadAhead ?? PRELOAD_AHEAD;

  return {
    name: "withAsync",
    priority: 20,

    methods: ["reload", "loadVisibleRange"] as const,

    setup(ctx: BuilderContext<T>): void {
      const { emitter } = ctx;
      const isReverse = ctx.config.reverse;

      // ── Grid-aware range conversion ──
      // When withGrid is active, viewportState.renderRange contains ROW indices
      // (e.g. rows 0-5), but ensureRange needs flat ITEM indices (e.g. 0-23
      // with 4 columns). The grid feature (priority 10) registers its layout
      // before us (priority 20), so we can resolve it once at setup time.
      type GridLayoutLike = {
        getItemRange: (rowStart: number, rowEnd: number, totalItems: number) => { start: number; end: number };
      };
      const getGridLayout = ctx.methods.get("_getGridLayout") as (() => GridLayoutLike | null) | undefined;

      /**
       * Convert the current viewportState.renderRange to flat item indices.
       * No-op when grid is not active — returns the range as-is.
       */
      const getItemRangeFromRenderRange = (renderRange: Range): Range => {
        if (getGridLayout) {
          const layout = getGridLayout();
          if (layout) {
            const total = ctx.dataManager.getTotal();
            return layout.getItemRange(renderRange.start, renderRange.end, total);
          }
        }
        return renderRange;
      };

      // ── Create adapter-backed data manager ──
      const newDataManager = createDataManager<T>({
        adapter,
        ...(total !== undefined && { initialTotal: total }),
        // Use chunkSize for pageSize to avoid loading multiple chunks initially
        // If chunkSize is 25 but pageSize is 50, loadInitial() loads 2 chunks = 2 requests
        pageSize: storage?.chunkSize ?? INITIAL_LOAD_SIZE,
        ...(storage && {
          storage: {
            ...(storage.chunkSize !== undefined && { chunkSize: storage.chunkSize }),
            ...(storage.maxCachedItems !== undefined && { maxCachedItems: storage.maxCachedItems }),
          },
        }),
        onStateChange: () => {
          if (ctx.state.isInitialized) {
            const newTotal = ctx.getVirtualTotal();
            ctx.sizeCache.rebuild(newTotal);
            ctx.updateCompressionMode();

            // Update compression metadata on viewport state, but do NOT
            // recalculate renderRange here. updateViewportItems uses the
            // default simpleVisibleRange which gives wrong indices when
            // withScale's compressed range function is active. The core
            // renderer always recalculates renderRange with the correct
            // installed visibleRangeFn, so we leave that to renderIfNeeded.
            const compression = ctx.getCachedCompression();
            ctx.state.viewportState.totalSize = compression.virtualSize;
            ctx.state.viewportState.actualSize = compression.actualSize;
            ctx.state.viewportState.isCompressed = compression.isCompressed;
            ctx.state.viewportState.compressionRatio = compression.ratio;

            ctx.updateContentSize(compression.virtualSize);
            ctx.renderIfNeeded();
          }
        },
        onItemsLoaded: (loadedItems, _offset, total) => {
          if (ctx.state.isInitialized) {
            // Force render to replace placeholders with actual data immediately
            // This is necessary so the DOM shows loaded items instead of placeholders
            ctx.forceRender();
            emitter.emit("load:end", { items: loadedItems, total, offset: _offset });
          }
        },
      });

      // Replace the core's basic data manager with the adapter-backed one
      ctx.replaceDataManager(newDataManager);

      // ── Velocity-aware scroll loading state ──
      let lastEnsuredRange: Range | null = null;
      let pendingRange: Range | null = null;
      let previousVelocity = 0;
      let wasAboveThreshold = false;
      let decelerationTimer: ReturnType<typeof setTimeout> | null = null;
      const DECELERATION_SETTLE_MS = 120;

      /**
       * Reset all deceleration-related state. Called when exiting the
       * deceleration phase for any reason (velocity near-zero, scroll
       * boundary hit, re-acceleration, or idle timeout).
       *
       * @param clearLastRange - also null out lastEnsuredRange so the
       *   rangeChanged check re-evaluates the current renderRange.
       *   Pass true when the pending range may be stale.
       */
      const resetDeceleration = (clearLastRange = false): void => {
        wasAboveThreshold = false;
        pendingRange = null;
        if (clearLastRange) lastEnsuredRange = null;
        if (decelerationTimer !== null) {
          clearTimeout(decelerationTimer);
          decelerationTimer = null;
        }
      };

      /**
       * Load data for the current visible range (called on idle / deceleration settle).
       *
       * The saved `pendingRange` acts as a boolean guard — we only fire when
       * loading was actually deferred during a fast scroll. But instead of
       * consuming the stale saved coordinates, we read the *live* renderRange
       * from viewportState. By the time the idle/deceleration timer fires the
       * smooth-scroll animation may have moved the viewport well past the
       * position where `pendingRange` was captured, so the saved range can
       * point at chunks the user has already scrolled past.
       */
      const loadPendingRange = (): void => {
        if (!pendingRange) return;
        pendingRange = null;

        const { renderRange } = ctx.state.viewportState;
        if (renderRange.end < renderRange.start) return;

        // Reset so the afterScroll rangeChanged check re-evaluates
        lastEnsuredRange = null;

        const itemRange = getItemRangeFromRenderRange(renderRange);
        ctx.dataManager
          .ensureRange(itemRange.start, itemRange.end)
          .catch((error) => {
            emitter.emit("error", { error, context: "ensureRange" });
          });
      };

      // ── Post-scroll: velocity-aware loading + load-more ──
      ctx.afterScroll.push(
        (scrollPosition: number, direction: string): void => {
          if (ctx.state.isDestroyed) return;

          const currentVelocity = ctx.scrollController.getVelocity();
          const velocityReliable = ctx.scrollController.isTracking();

          // Only allow loading when velocity tracker is reliable and below threshold
          let canLoad =
            velocityReliable && currentVelocity <= cancelLoadThreshold;

          // Track when we transition from above-threshold to below-threshold.
          // During deceleration the velocity drops gradually, and the render
          // range still changes rapidly. Instead of firing ensureRange on
          // every frame, we enter a "deceleration settling" phase that defers
          // loading until the scroll stabilises (no new frame for
          // DECELERATION_SETTLE_MS) or velocity drops to near-zero.
          if (previousVelocity > cancelLoadThreshold && currentVelocity <= cancelLoadThreshold) {
            wasAboveThreshold = true;
          } else if (wasAboveThreshold && currentVelocity > cancelLoadThreshold) {
            // Velocity went back above threshold — a new fast scroll gesture,
            // not deceleration anymore.
            resetDeceleration();
          }

          // Exit deceleration phase once velocity is negligible.
          // Don't eagerly load pendingRange here — the rangeChanged block
          // below will see canLoad && !isDecelerating and fire ensureRange
          // for the *current* renderRange, which is more accurate than the
          // potentially stale pendingRange saved on a previous frame.
          if (wasAboveThreshold && currentVelocity < 0.5) {
            resetDeceleration(true);
          }

          previousVelocity = currentVelocity;

          // Detect scroll boundary — when we've hit the top or bottom,
          // the scroll can't continue so deferring loads is pointless.
          // Override velocity gating and flush immediately.
          const atEdge =
            ctx.scrollController.isAtTop() ||
            ctx.scrollController.isAtBottom();

          if (atEdge && (wasAboveThreshold || pendingRange)) {
            resetDeceleration(true);
            canLoad = true;
          }

          const isDecelerating = wasAboveThreshold && currentVelocity > 0.5;

          // ── Check for infinite scroll (load more) ──
          if (
            canLoad &&
            !ctx.dataManager.getIsLoading() &&
            ctx.dataManager.getHasMore()
          ) {
            if (isReverse) {
              // Reverse mode: trigger "load more" near the TOP
              if (scrollPosition < LOAD_THRESHOLD) {
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
                ctx.state.viewportState.totalSize -
                scrollPosition -
                ctx.state.viewportState.containerSize;

              if (distanceFromBottom < LOAD_THRESHOLD) {
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

            if (canLoad && !isDecelerating) {
              // Velocity is low and stable — load immediately
              pendingRange = null;
              if (decelerationTimer !== null) {
                clearTimeout(decelerationTimer);
                decelerationTimer = null;
              }

              // Convert row-space renderRange to item-space for ensureRange
              const itemRange = getItemRangeFromRenderRange(renderRange);

              // Calculate preload range based on scroll direction and velocity
              let loadStart = itemRange.start;
              let loadEnd = itemRange.end;
              // In grid mode, virtualTotal is row count — use real item total for clamping.
              // In non-grid mode, virtualTotal equals item total.
              const total = getGridLayout
                ? ctx.dataManager.getTotal()
                : ctx.getVirtualTotal();

              if (currentVelocity > preloadThreshold) {
                if (direction === "down") {
                  loadEnd = Math.min(itemRange.end + preloadAhead, total - 1);
                } else {
                  loadStart = Math.max(itemRange.start - preloadAhead, 0);
                }
              }

              ctx.dataManager.ensureRange(loadStart, loadEnd).catch((error) => {
                emitter.emit("error", { error, context: "ensureRange" });
              });
            } else {
              // Either scrolling too fast OR decelerating from a fast scroll.
              // Save the range and defer loading until scroll settles.
              pendingRange = {
                start: renderRange.start,
                end: renderRange.end,
              };

              // During deceleration, use a short timer to catch the moment
              // the range stops changing. This avoids waiting for full idle
              // (200ms) while still preventing per-frame request bursts.
              if (isDecelerating) {
                if (decelerationTimer !== null) {
                  clearTimeout(decelerationTimer);
                }
                decelerationTimer = setTimeout(() => {
                  decelerationTimer = null;
                  loadPendingRange();
                  resetDeceleration();
                }, DECELERATION_SETTLE_MS);
              }
            }
          }
        },
      );

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
      ctx.afterScroll.push(
        (_scrollPosition: number, _direction: string): void => {
          // Reset idle timer on every scroll frame
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(() => {
            idleTimer = null;
            // Scroll has fully stopped — load pending data then reset
            // deceleration state so the next gesture starts clean.
            loadPendingRange();
            resetDeceleration();
          }, idleMs);
        },
      );

      // Clean up timers on destroy
      ctx.destroyHandlers.push(() => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        resetDeceleration();
      });

      // ── Network recovery: reload visible placeholders when back online ──
      // When the network fails, placeholders stay in place because no scroll
      // event fires to retrigger fetching. Listening to the browser's `online`
      // event lets us re-ensure the visible range as soon as connectivity
      // returns. ensureRange already skips fully-loaded ranges, so this only
      // fetches chunks that actually failed.
      const handleOnline = (): void => {
        if (ctx.state.isDestroyed) return;

        // Reset so the afterScroll logic doesn't think we already loaded it
        lastEnsuredRange = null;

        const { renderRange } = ctx.state.viewportState;
        if (renderRange.end > 0) {
          const itemRange = getItemRangeFromRenderRange(renderRange);
          ctx.dataManager
            .ensureRange(itemRange.start, itemRange.end)
            .catch((error) => {
              emitter.emit("error", { error, context: "ensureRange" });
            });
        }

        // Also flush any range that was pending when the network dropped
        loadPendingRange();
      };

      window.addEventListener("online", handleOnline);

      ctx.destroyHandlers.push(() => {
        window.removeEventListener("online", handleOnline);
      });

      // ── ARIA: aria-busy for loading state ──
      emitter.on("load:start", () => {
        ctx.dom.root.setAttribute("aria-busy", "true");
      });
      emitter.on("load:end", () => {
        ctx.dom.root.removeAttribute("aria-busy");
      });

      // ── Register loadVisibleRange method ──
      // Loads data for the currently visible range without resetting total or
      // clearing existing data. Used by restoreScroll to load data at a
      // restored scroll position without the destructive reset that reload()
      // performs (which sets total=0, shrinks content, and resets scrollTop).
      ctx.methods.set("loadVisibleRange", async (): Promise<void> => {
        lastEnsuredRange = null;
        pendingRange = null;

        // Force render so renderRange reflects the current scroll position
        ctx.forceRender();

        const { renderRange } = ctx.state.viewportState;
        if (renderRange.end > 0) {
          const itemRange = getItemRangeFromRenderRange(renderRange);
          emitter.emit("load:start", {
            offset: itemRange.start,
            limit: itemRange.end - itemRange.start + 1,
          });
          await ctx.dataManager.ensureRange(itemRange.start, itemRange.end);
        }
      });

      // ── Register reload method ──
      ctx.methods.set("reload", async (options?: { skipInitialLoad?: boolean }): Promise<void> => {
        lastEnsuredRange = null;
        pendingRange = null;

        // Clear all rendered DOM elements so the renderer recreates them
        // from scratch. Without this, items whose ID didn't change
        // (e.g. same index → same id after switching data source) would
        // keep their old template content due to the ID-match optimisation.
        ctx.invalidateRendered();

        // Clear old data and reset total to 0
        await ctx.dataManager.reload();

        if (!options?.skipInitialLoad) {
          // Load initial data first (this will update total and trigger onStateChange)
          // The onStateChange callback will call forceRender automatically when data arrives
          emitter.emit("load:start", { offset: 0, limit: INITIAL_LOAD_SIZE });
          await ctx.dataManager.loadInitial();

          // Force a render to immediately show placeholders (good UX while
          // the API responds) and to guarantee viewportState.renderRange
          // reflects the correct visible range — including compressed mode.
          ctx.forceRender();

          // After reload, ensure the currently visible range is loaded.
          // Without this, if the user is scrolled past the initial page,
          // placeholders are never replaced because no scroll event fires.
          const { renderRange } = ctx.state.viewportState;
          if (renderRange.end > 0) {
            const itemRange = getItemRangeFromRenderRange(renderRange);
            await ctx.dataManager.ensureRange(itemRange.start, itemRange.end);
          }
        }
      });

      // ── Load initial data (if autoLoad is enabled) ──
      if (autoLoad) {
        emitter.emit("load:start", { offset: 0, limit: INITIAL_LOAD_SIZE });
        ctx.dataManager.loadInitial().catch((error) => {
          emitter.emit("error", { error, context: "loadInitial" });
        });
      } else if (total !== undefined) {
        // If autoLoad is disabled but total is provided, set it so the vlist knows the size
        ctx.dataManager.setTotal(total);
      }
    },
  };
};
