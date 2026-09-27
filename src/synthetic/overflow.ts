/**
 * overflow() — native input that hands over to synthetic input past the
 * browser's element size limit, and back (RFC-015).
 *
 * The core swaps the handler (`ctx.scroll.setInput`); this plugin decides when,
 * and moves the position across. It lives beside the synthetic handler so the
 * `vlist` entry never bundles the driver: only lists that import it pay for it.
 */
import type { VListItem } from "../types";
import type { PluginContext, VListPlugin } from "../core/types";
import type { BoundedScrollHandler } from "../core/runway";
import { MAX_VIRTUAL_SIZE } from "../constants";
import { createSyntheticScrollHandler } from "./handler";

export interface OverflowPluginConfig {
  /** Content size (px) above which input goes synthetic. Default 16,000,000. */
  threshold?: number;
  /** Content size (px) below which native input returns. Default 0.75 × threshold. */
  returnBelow?: number;
}

export function overflow<T extends VListItem = VListItem>(options: OverflowPluginConfig = {}): VListPlugin<T> {
  const above = options.threshold ?? MAX_VIRTUAL_SIZE;
  const below = options.returnBelow ?? above * 0.75;
  let ctx: PluginContext<T>;
  let synthetic: BoundedScrollHandler | null = null;
  let size = 0;
  let pending = false;

  function check(): void {
    if (synthetic ? size >= below : size <= above) { pending = false; return; }
    // Never cut a scroll off. Until idle a native list keeps its full size and
    // the browser clamps it, which the smooth-scroll commit renders (FLO-247).
    pending = ctx.dom.root.classList.contains(ctx.config.classPrefix + "--scrolling");
    if (pending) return;

    const state = ctx.getState();
    const position = state.scrollPosition;
    const { viewport, content } = ctx.dom;
    const isX = ctx.config.axis.primary === "x";
    if (synthetic) {
      synthetic = ctx.scroll.setInput(null);
      state.baseOffset = 0;
      // The core writes the same size after this callback; the position below
      // needs it now.
      content.style[isX ? "width" : "height"] = size + "px";
      const target = Math.min(position, Math.max(0, size - state.containerSize));
      if (isX) viewport.scrollLeft = target;
      else viewport.scrollTop = target;
      // What the browser applied, as the smooth-scroll commit does.
      ctx.scroll.commit(isX ? viewport.scrollLeft : viewport.scrollTop);
    } else {
      if (isX) viewport.scrollLeft = 0;
      else viewport.scrollTop = 0;
      synthetic = ctx.scroll.setInput(createSyntheticScrollHandler)!;
      synthetic.refresh(size - ctx.config.mainAxisPadding);
      // During creation the core renders and attaches next; a commit here
      // would mark the list scrolling before any idle timer can clear it.
      if (state.initialized) synthetic.setLogical(position);
    }
    ctx.emitter.emit("scroll:mode", { mode: synthetic ? "synthetic" : "native" });
  }

  return {
    name: "overflow",
    priority: 5,
    // page(): a window-scrolled list has no content element to hand over.
    // carousel(): its wrap runway is bounded already.
    conflicts: ["page", "carousel"],

    setup(context: PluginContext<T>): void {
      ctx = context;
      ctx.scroll.watchSize((px) => { size = px; check(); });
    },

    hooks: {
      onIdle(): void { if (pending) check(); },
    },
  };
}
