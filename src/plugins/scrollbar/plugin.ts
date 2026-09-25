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

  return {
    name: "scrollbar",
    priority: 15,

    setup(ctx: PluginContext<T>): void {
      const { dom, config: resolvedConfig } = ctx;
      const { classPrefix } = resolvedConfig;
      const isX = resolvedConfig.axis.primary === "x";

      engineState = ctx.getState();
      mainAxisPadding = resolvedConfig.mainAxisPadding;

      // Route through ctx.scroll.to so the position reaches the bounded handler's
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

      dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);

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
        sb?.destroy();
        sb = null;
        dom.viewport.classList.remove(`${classPrefix}-viewport--custom-scrollbar`);
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
