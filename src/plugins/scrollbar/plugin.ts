/**
 * vlist — Scrollbar Plugin
 *
 * Replaces the native scrollbar with a custom, cross-browser consistent scrollbar.
 * Priority 15 — runs after layout plugins (10) but before selection (50).
 *
 * Uses the v1 scrollbar UI component directly — it's standalone DOM/events code
 * with no framework dependencies. This plugin wires it into the v2 lifecycle:
 * - onAfterScroll hook → update thumb position
 * - onResize hook → update thumb/track bounds
 * - destroy → cleanup
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import { createScrollbar, type Scrollbar, type ScrollbarConfig } from "./scrollbar";

// =============================================================================
// Config
// =============================================================================

export interface ScrollbarPluginConfig extends ScrollbarConfig {
  gutter?: boolean;
}

// =============================================================================
// Factory
// =============================================================================

/** Methods the scrollbar plugin adds to the list instance. */
export interface ScrollbarMethods {
  /** Recompute the thumb from the current content size. */
  refreshScrollbar(): void;
}

export function scrollbar<T extends VListItem = VListItem>(
  config?: ScrollbarPluginConfig,
): VListPlugin<T, ScrollbarMethods> {
  let sb: Scrollbar | null = null;
  let engineState: EngineState;
  let mainAxisPadding = 0;
  let lastBoundsTotal = 0;
  let lastBoundsContainer = 0;
  let syncNativeBar = (): void => {};

  return {
    name: "scrollbar",
    priority: 15,

    setup(ctx: PluginContext<T>): void {
      const { dom, config: resolvedConfig } = ctx;
      const { classPrefix } = resolvedConfig;
      const isX = resolvedConfig.axis.primary === "x";

      engineState = ctx.getState();
      mainAxisPadding = resolvedConfig.mainAxisPadding;

      // Route through ctx.scroll.to so the position reaches a logical handler's
      // setLogical (which clamps using maxLogical that includes padding) rather
      // than the adapter's clampPixel (which only knows sizeCache, no padding).
      sb = createScrollbar(
        dom.viewport,
        (position: number) => { ctx.scroll.to(position); },
        config,
        classPrefix,
        isX,
        dom.root,
        () => ctx.sizes.cache,
        dom.root.parentElement!,
      );

      const customClass = `${classPrefix}-viewport--custom-scrollbar`;
      // table() publishes this during its setup. role="grid" is not enough:
      // any grid would lose its thumb, and the class marker must stay out of
      // this bundle.
      const table = !isX && ctx.hooks.get("_getTableLayout");
      // A table keeps the browser's horizontal bar for its columns, so its
      // stylesheet cannot hide the native vertical bar the way a plain list
      // does, and Chrome paints that bar beside or over a custom thumb (#514).
      // While a table scrolls natively, use the browser's own vertical bar and
      // draw none: the viewport is then styled as if scrollbar() were absent.
      // A synthetic table (overflow hidden) has no native bar and keeps the
      // custom thumb. A natively scrolling table never takes our viewport
      // class: under it the table stylesheet turns the native bar back on. So
      // when its author hides the native bar (scrollbar-width: none, read
      // from the computed style so a rule of any specificity counts), the
      // custom thumb is drawn and the author's rule stays in force.
      // Runs at setup, on resize and on a mode switch, never per scroll.
      syncNativeBar = (): void => {
        const vp = dom.viewport;
        const nativeTable = !!table
          && ctx.config.scrollMode !== "synthetic"
          && vp.style.overflowY !== "hidden";
        vp.classList.toggle(customClass, !nativeTable);
        sb?.useNativeBar(nativeTable
          && vp.style.scrollbarWidth !== "none"
          && getComputedStyle(vp).getPropertyValue("scrollbar-width") !== "none");
      };
      syncNativeBar();
      const offMode = ctx.emitter.on("scroll:mode", syncNativeBar);

      ctx.hooks.method("refreshScrollbar", () => sb?.refresh());

      // Defer initial bounds update — containerSize may be 0 during setup
      // since the viewport hasn't been laid out yet. The resize observer
      // will fire with the correct size after first paint.
      queueMicrotask(() => {
        sb?.updateBounds(engineState.totalSize + mainAxisPadding, engineState.containerSize);
      });

      // Expose scrollbar instance for cross-plugin bounds coordination
      ctx.hooks.method("_scrollbar:getInstance", () => sb);

      ctx.hooks.onDestroy(() => {
        offMode();
        sb?.destroy();
        sb = null;
        dom.viewport.classList.remove(customClass);
        if (config?.gutter) {
          dom.viewport.classList.remove(`${classPrefix}-viewport--gutter`);
        }
      });
    },

    hooks: {
      onAfterScroll(scrollPosition: number): void {
        const total = engineState.totalSize + mainAxisPadding;
        const container = engineState.containerSize;
        if (total !== lastBoundsTotal || container !== lastBoundsContainer) {
          lastBoundsTotal = total;
          lastBoundsContainer = container;
          sb?.updateBounds(total, container);
        }
        sb?.updatePosition(scrollPosition);
        sb?.show();
      },

      onResize(): void {
        syncNativeBar();
        const total = engineState.totalSize + mainAxisPadding;
        const container = engineState.containerSize;
        lastBoundsTotal = total;
        lastBoundsContainer = container;
        sb?.updateBounds(total, container);
      },
    },

    destroy(): void {
      sb?.destroy();
      sb = null;
    },
  };
}
