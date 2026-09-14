/**
 * vlist v2 — Page (Window Scroll) Plugin
 *
 * Redirects scroll from the viewport to the window, enabling
 * the list to scroll with the page. Useful for infinite feeds,
 * full-page lists, and document-integrated virtual scrolling.
 *
 * Priority: 5 (runs early, before plugins that depend on scroll)
 */

import { MAX_ELEMENT_SIZE } from "../../constants";
import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

// =============================================================================
// Config
// =============================================================================

export interface PagePluginConfig {
  scrollPadding?: {
    top?: number | (() => number);
    bottom?: number | (() => number);
    left?: number | (() => number);
    right?: number | (() => number);
  };
}

// =============================================================================
// Helpers
// =============================================================================

const resolvePad = (v: number | (() => number) | undefined): number =>
  v == null ? 0 : typeof v === "function" ? v() : v;

// =============================================================================
// Factory
// =============================================================================

export function page<T extends VListItem = VListItem>(
  config?: PagePluginConfig,
): VListPlugin<T> {
  const scrollPadding = config?.scrollPadding;
  let cleanupResize: (() => void) | undefined;
  let cleanupScroll: (() => void) | undefined;

  return {
    name: "page",
    priority: 5,

    setup(ctx: PluginContext<T>): void {
      const { dom, sizeCache, config: cfg, emitter } = ctx;
      const isX = cfg.axis.primary === "x";
      const win = window;
      const state = ctx.getState();

      // ── 1. Own window resize ────────────
      ctx.disableDefaultResize();

      // ── 2. Modify DOM for window scroll ────────────────────────
      dom.root.style.overflow = "visible";
      dom.root.style.height = "auto";

      if (isX) {
        dom.viewport.style.overflowX = "visible";
        dom.viewport.style.overflowY = "visible";
      } else {
        dom.viewport.style.overflow = "visible";
      }

      dom.viewport.classList.remove(`${cfg.classPrefix}-viewport--custom-scrollbar`);

      // ── 3. Install the external scroll writer ─────────────────────
      let sized = false;
      let warned = false;
      ctx.setScrollSource({
        onContentSize(pixels): void {
          if (pixels > MAX_ELEMENT_SIZE && !warned) {
            const message = `vlist: page() native document size ${pixels}px exceeds the ${MAX_ELEMENT_SIZE}px limit. Use the viewport-scrolled default for larger lists. See https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model`;
            if (!sized) {
              cleanupScroll?.();
              cleanupResize?.();
              dom.root.remove();
              throw new Error(message);
            }
            warned = true;
            console.warn(message);
          }
          sized = true;
        },
        write(pos: number): void {
          const rect = dom.viewport.getBoundingClientRect();
          const target = (isX ? rect.left + win.scrollX : rect.top + win.scrollY) + pos;
          if (isX) {
            win.scrollTo({ left: target, top: win.scrollY, behavior: "instant" });
          } else {
            win.scrollTo({ left: win.scrollX, top: target, behavior: "instant" });
          }
          // Read-after-write must not wait for the asynchronous window event.
          ctx.commitScroll(pos);
        },
      });

      // ── 4. Set container size from window ──────────────────────
      state.containerSize = isX ? win.innerWidth : win.innerHeight;
      state.crossSize = isX ? win.innerHeight : win.innerWidth;

      // ── 5. Window scroll listener ──────────────────────────────
      const onWindowScroll = (): void => {
        const rect = dom.viewport.getBoundingClientRect();
        const pos = Math.max(0, isX ? -rect.left : -rect.top);

        if (Math.abs(pos - ctx.scroll.getPixelEquivalent()) < 0.5) return;
        ctx.commitScroll(pos);
      };

      win.addEventListener("scroll", onWindowScroll, { passive: true });
      cleanupScroll = () => win.removeEventListener("scroll", onWindowScroll);

      // ── 6. Window resize listener ──────────────────────────────
      let prevW = win.innerWidth;
      let prevH = win.innerHeight;

      const onWindowResize = (): void => {
        const w = win.innerWidth;
        const h = win.innerHeight;
        const sizeDelta = isX ? Math.abs(w - prevW) : Math.abs(h - prevH);

        if (sizeDelta < 1) return;

        prevW = w;
        prevH = h;
        state.containerSize = isX ? w : h;
        state.crossSize = isX ? h : w;

        ctx.forceRender();
        emitter.emit("resize", { width: w, height: h });
      };

      win.addEventListener("resize", onWindowResize);
      cleanupResize = () => win.removeEventListener("resize", onWindowResize);

      // ── 7. Scroll padding (scrollToIndex adjustments) ──────────
      if (scrollPadding) {
        ctx.setScrollToPosFn((index, sc, containerSize, totalItems, align) => {
          const startPad = resolvePad(isX ? scrollPadding.left : scrollPadding.top);
          const endPad = resolvePad(isX ? scrollPadding.right : scrollPadding.bottom);
          if (totalItems === 0) return 0;
          const clamped = Math.max(0, Math.min(index, totalItems - 1));
          const offset = sc.getOffset(clamped);
          const itemSize = sc.getSize(clamped);
          const totalSize = sc.getTotalSize();
          const maxScroll = Math.max(0, totalSize - containerSize + endPad);
          let pos: number;
          switch (align) {
            case "center":
              pos = offset - startPad - (containerSize - startPad - endPad - itemSize) / 2;
              break;
            case "end":
              pos = offset - containerSize + itemSize + endPad;
              break;
            default:
              pos = offset - startPad;
          }
          return Math.max(-startPad, Math.min(pos, maxScroll));
        });

        ctx.registerMethod("_scrollItemIntoView", (index: number): void => {
          const containerSize = isX ? win.innerWidth : win.innerHeight;
          const startPad = resolvePad(isX ? scrollPadding.left : scrollPadding.top);
          const endPad = resolvePad(isX ? scrollPadding.right : scrollPadding.bottom);

          const rect = dom.viewport.getBoundingClientRect();
          const domScroll = isX ? win.scrollX : win.scrollY;
          const listScreenPos = isX ? rect.left : rect.top;
          const listDocPos = listScreenPos + domScroll;

          const itemOffset = sizeCache.getOffset(index);
          const itemSize = sizeCache.getSize(index);
          const itemScreenStart = listScreenPos + itemOffset;
          const safeEnd = containerSize - endPad;

          let newTarget = domScroll;

          if (itemScreenStart < startPad) {
            newTarget = listDocPos + itemOffset - startPad;
          } else if (itemScreenStart + itemSize > safeEnd) {
            newTarget = listDocPos + itemOffset + itemSize - safeEnd;
          }

          if (newTarget !== domScroll) {
            if (isX) {
              win.scrollTo({ left: newTarget, top: win.scrollY, behavior: "instant" });
            } else {
              win.scrollTo({ left: win.scrollX, top: newTarget, behavior: "instant" });
            }
          }
        });
      }

      // ── 8. Register cleanup ────────────────────────────────────
      ctx.registerDestroyHandler(() => {
        cleanupScroll?.();
        cleanupResize?.();
      });
    },

    destroy(): void {
      cleanupScroll?.();
      cleanupResize?.();
      cleanupScroll = undefined;
      cleanupResize = undefined;
    },
  };
}
