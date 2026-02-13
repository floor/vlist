/**
 * vlist/scroll - Builder Plugin
 * Wraps the custom scrollbar into a VListPlugin for the composable builder.
 *
 * Priority: 30 (runs after renderer/data setup but before selection)
 *
 * What it wires:
 * - DOM elements — track, thumb, and optional hover zone appended to viewport
 * - CSS class — .vlist-viewport--custom-scrollbar hides native scrollbar
 * - Drag handlers — mousedown on thumb, mousemove/mouseup on document
 * - Track click — click on track to jump to position
 * - Hover handlers — mouseenter/leave on track, hover zone, and viewport
 * - Scroll sync — updates thumb position on every scroll frame
 * - Resize sync — updates thumb size when container or content height changes
 *
 * No public methods are added — the scrollbar is entirely automatic.
 */

import type { VListItem } from "../types";
import type { VListPlugin, BuilderContext } from "../builder/types";

import { createScrollbar, type Scrollbar } from "./scrollbar";

// =============================================================================
// Plugin Config
// =============================================================================

/** Scrollbar plugin configuration */
export interface ScrollbarPluginConfig {
  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;

  /**
   * Show scrollbar when hovering near the scrollbar edge (default: true).
   * When true, an invisible hover zone is placed along the scrollbar edge.
   */
  showOnHover?: boolean;

  /**
   * Width of the invisible hover zone in pixels (default: 16).
   * Only used when `showOnHover` is true.
   */
  hoverZoneWidth?: number;

  /**
   * Show scrollbar when the mouse enters the list viewport (default: true).
   * When false, the scrollbar only appears on scroll or hover near edge.
   */
  showOnViewportEnter?: boolean;
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create a scrollbar plugin for the builder.
 *
 * Replaces the native browser scrollbar with a custom, cross-browser
 * consistent scrollbar.
 *
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withScrollbar } from 'vlist/scroll'
 *
 * const list = vlist({ ... })
 *   .use(withScrollbar({ autoHide: true, autoHideDelay: 1000 }))
 *   .build()
 * ```
 */
export const withScrollbar = <T extends VListItem = VListItem>(
  config?: ScrollbarPluginConfig,
): VListPlugin<T> => {
  let scrollbar: Scrollbar | null = null;

  return {
    name: "withScrollbar",
    priority: 30,

    setup(ctx: BuilderContext<T>): void {
      const { dom, config: resolvedConfig } = ctx;
      const { classPrefix, horizontal } = resolvedConfig;

      // Create custom scrollbar
      scrollbar = createScrollbar(
        dom.viewport,
        (position) => ctx.scrollController.scrollTo(position),
        config ?? {},
        classPrefix,
        horizontal,
      );

      // Ensure native scrollbar is hidden
      if (
        !dom.viewport.classList.contains(
          `${classPrefix}-viewport--custom-scrollbar`,
        )
      ) {
        dom.viewport.classList.add(`${classPrefix}-viewport--custom-scrollbar`);
      }

      // Set initial bounds
      const compression = ctx.getCachedCompression();
      scrollbar.updateBounds(
        compression.virtualHeight,
        ctx.state.viewportState.containerHeight,
      );

      // ── Post-scroll: update thumb position ──
      const scrollbarRef = scrollbar;
      ctx.afterScroll.push((scrollTop: number, _direction: string): void => {
        scrollbarRef.updatePosition(scrollTop);
        scrollbarRef.show();
      });

      // ── Resize: update thumb size ──
      ctx.resizeHandlers.push((_width: number, _height: number): void => {
        if (scrollbarRef) {
          const comp = ctx.getCachedCompression();
          scrollbarRef.updateBounds(
            comp.virtualHeight,
            ctx.state.viewportState.containerHeight,
          );
        }
      });

      // ── Content size change: update scrollbar bounds when items change ──
      ctx.contentSizeHandlers.push((): void => {
        if (scrollbarRef) {
          const comp = ctx.getCachedCompression();
          scrollbarRef.updateBounds(
            comp.virtualHeight,
            ctx.state.viewportState.containerHeight,
          );
        }
      });

      // ── Cleanup ──
      ctx.destroyHandlers.push(() => {
        if (scrollbarRef) {
          scrollbarRef.destroy();
        }
      });
    },

    destroy(): void {
      if (scrollbar) {
        scrollbar.destroy();
        scrollbar = null;
      }
    },
  };
};
