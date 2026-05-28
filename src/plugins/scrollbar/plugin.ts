/**
 * vlist v2 — Scrollbar Plugin
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

export function scrollbar<T extends VListItem = VListItem>(
  config?: ScrollbarPluginConfig,
): VListPlugin<T> {
  let sb: Scrollbar | null = null;
  let engineState: EngineState;
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

      // Indirect callback — scale plugin can redirect via registerMethod
      let scrollCb = (position: number): void => {
        if (isX) dom.viewport.scrollLeft = position;
        else dom.viewport.scrollTop = position;
      };
      ctx.registerMethod("_scrollbar:setCallback", (cb: (pos: number) => void) => { scrollCb = cb; });

      sb = createScrollbar(
        dom.viewport,
        (position: number) => { scrollCb(position); },
        config,
        classPrefix,
        isX,
        dom.root,
      );

      dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);

      if (config?.gutter) {
        dom.viewport.classList.add(`${classPrefix}-viewport--gutter`);
      }

      // Defer initial bounds update — containerSize may be 0 during setup
      // since the viewport hasn't been laid out yet. The resize observer
      // will fire with the correct size after first paint.
      // Skip if compressed — the scale plugin owns bounds in that case.
      queueMicrotask(() => {
        if (!engineState.isCompressed) {
          sb?.updateBounds(engineState.totalSize, engineState.containerSize);
        }
      });

      // Expose scrollbar instance for cross-plugin coordination (scale plugin)
      ctx.registerMethod("_scrollbar:getInstance", () => sb);

      ctx.registerDestroyHandler(() => {
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
        if (!engineState.isCompressed) {
          const total = engineState.totalSize;
          const container = engineState.containerSize;
          if (total !== lastBoundsTotal || container !== lastBoundsContainer) {
            lastBoundsTotal = total;
            lastBoundsContainer = container;
            sb?.updateBounds(total, container);
          }
        }
        sb?.updatePosition(scrollPosition);
        sb?.show();
      },

      onResize(): void {
        if (!engineState.isCompressed) {
          const total = engineState.totalSize;
          const container = engineState.containerSize;
          lastBoundsTotal = total;
          lastBoundsContainer = container;
          sb?.updateBounds(total, container);
        }
      },
    },

    destroy(): void {
      sb?.destroy();
      sb = null;
    },
  };
}
